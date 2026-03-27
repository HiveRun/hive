defmodule HiveServerElixirWeb.CellsControllerTest do
  use HiveServerElixirWeb.ConnCase

  import Ash.Expr
  require Ash.Query

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Activity
  alias HiveServerElixir.Cells.AgentSession
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Provisioning
  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.ServiceRuntime
  alias HiveServerElixir.Cells.Timing
  alias HiveServerElixir.Cells.Workspace

  test "GET /api/cells/:id/setup/terminal/stream emits ready and snapshot semantics", %{
    conn: conn
  } do
    workspace = workspace!("setup-terminal-stream")
    cell = cell!(workspace.id, "setup terminal cell", "provisioning")

    conn = get(conn, ~p"/api/cells/#{cell.id}/setup/terminal/stream?initialOnly=true")

    assert conn.status == 200
    assert conn.resp_body =~ "event: ready"
    assert conn.resp_body =~ "event: snapshot"
  end

  test "GET /api/cells/:id/setup/terminal/stream returns 404 for missing cells", %{conn: conn} do
    conn = get(conn, ~p"/api/cells/#{Ash.UUID.generate()}/setup/terminal/stream?initialOnly=true")

    assert %{"error" => %{"code" => "not_found"}} = json_response(conn, 404)
  end

  test "POST /api/cells/:id/setup/terminal/input returns ok for valid data", %{conn: conn} do
    workspace = workspace!("setup-terminal-input")
    cell = cell!(workspace.id, "setup terminal cell", "provisioning")

    conn = post(conn, ~p"/api/cells/#{cell.id}/setup/terminal/input", %{"data" => "echo hi"})

    assert %{"ok" => true} = json_response(conn, 200)
  end

  test "POST /api/cells/:id/setup/terminal/resize returns resized session", %{conn: conn} do
    workspace = workspace!("setup-terminal-resize")
    cell = cell!(workspace.id, "setup terminal cell", "provisioning")

    conn =
      post(conn, ~p"/api/cells/#{cell.id}/setup/terminal/resize", %{"cols" => 100, "rows" => 30})

    assert %{"ok" => true, "session" => %{"cols" => 100, "rows" => 30}} = json_response(conn, 200)
  end

  test "GET /api/cells/:id/services/:service_id/terminal/stream emits ready and snapshot", %{
    conn: conn
  } do
    workspace = workspace!("service-terminal-stream")
    cell = cell!(workspace.id, "service terminal cell", "ready")

    assert {:ok, service} =
             Ash.create(
               Service,
               %{
                 cell_id: cell.id,
                 name: "api",
                 type: "process",
                 command: "sleep 5",
                 cwd: "/tmp",
                 env: %{},
                 definition: %{}
               },
               domain: Cells
             )

    assert {:ok, _service} = Ash.update(service, %{pid: 42}, action: :mark_running, domain: Cells)

    on_exit(fn ->
      :ok = ServiceRuntime.stop_cell_services(cell.id)
    end)

    conn =
      get(
        conn,
        ~p"/api/cells/#{cell.id}/services/#{service.id}/terminal/stream?initialOnly=true"
      )

    assert conn.status == 200
    assert conn.resp_body =~ "event: ready"
    assert conn.resp_body =~ "event: snapshot"
  end

  test "POST /api/cells/:id/services/:service_id/terminal/input returns 404 for unknown service",
       %{conn: conn} do
    workspace = workspace!("service-terminal-input-missing")
    cell = cell!(workspace.id, "service terminal cell", "ready")

    conn =
      post(conn, ~p"/api/cells/#{cell.id}/services/#{Ash.UUID.generate()}/terminal/input", %{
        "data" => "hello"
      })

    assert %{"error" => %{"code" => "not_found"}} = json_response(conn, 404)
  end

  test "GET /api/cells/:id/services/stream emits ready, services, and snapshot", %{conn: conn} do
    workspace = workspace!("services-stream")
    cell = cell!(workspace.id, "service stream", "ready")

    assert {:ok, _service} =
             Ash.create(
               Service,
               %{
                 cell_id: cell.id,
                 name: "api",
                 type: "process",
                 command: "sleep 5",
                 cwd: "/tmp",
                 env: %{},
                 definition: %{}
               },
               domain: Cells
             )

    conn = get(conn, ~p"/api/cells/#{cell.id}/services/stream?initialOnly=true")

    assert conn.status == 200
    assert conn.resp_body =~ "event: ready"
    assert conn.resp_body =~ "event: service"
    assert conn.resp_body =~ "event: snapshot"
  end

  test "POST /api/cells/:id/chat/terminal/restart rotates terminal session", %{conn: conn} do
    workspace = workspace!("chat-terminal-restart")
    cell = cell!(workspace.id, "chat terminal cell", "ready")

    conn = get(conn, ~p"/api/cells/#{cell.id}/chat/terminal/stream?initialOnly=true")
    assert conn.status == 200

    first_session_id = ready_session_id(conn.resp_body)
    assert is_binary(first_session_id)

    conn = post(conn, ~p"/api/cells/#{cell.id}/chat/terminal/restart", %{})

    assert %{"sessionId" => second_session_id} = json_response(conn, 200)
    assert second_session_id != first_session_id
  end

  test "POST /api/cells/:id/chat/terminal/input returns conflict while provisioning", %{
    conn: conn
  } do
    workspace = workspace!("chat-terminal-conflict")
    cell = cell!(workspace.id, "chat terminal cell", "provisioning")

    conn = post(conn, ~p"/api/cells/#{cell.id}/chat/terminal/input", %{"data" => "hello"})

    assert %{"error" => %{"code" => "chat_unavailable"}} = json_response(conn, 409)
  end

  test "GET /api/cells/:id/diff returns git-backed summary and details", %{conn: conn} do
    repo_path = git_fixture_repo!("diff-summary")
    workspace = workspace_with_path!(repo_path, "diff")
    cell = cell!(workspace.id, "diff cell", "ready")

    conn = get(conn, ~p"/api/cells/#{cell.id}/diff?mode=workspace")

    assert %{"mode" => "workspace", "files" => files} = json_response(conn, 200)
    assert [%{"path" => "notes.txt", "status" => "modified"}] = files

    conn = get(conn, ~p"/api/cells/#{cell.id}/diff?mode=workspace&files=notes.txt&summary=none")

    assert %{"mode" => "workspace", "details" => [detail]} = json_response(conn, 200)
    assert detail["path"] == "notes.txt"
    assert detail["beforeContent"] =~ "initial"
    assert detail["afterContent"] =~ "updated"
    assert detail["patch"] =~ "notes.txt"
  end

  test "GET /api/cells/:id/diff returns 409 while cell workspace is not ready", %{conn: conn} do
    workspace = workspace!("diff-provisioning")
    cell = cell!(workspace.id, "diff provisioning", "provisioning")

    conn = get(conn, ~p"/api/cells/#{cell.id}/diff?mode=workspace")

    assert %{"message" => "Cell workspace is not ready yet"} = json_response(conn, 409)
  end

  test "GET /api/cells/:id/diff returns 400 for branch mode without base commit", %{conn: conn} do
    workspace = workspace!("diff-branch")
    cell = cell!(workspace.id, "diff branch", "ready")

    conn = get(conn, ~p"/api/cells/#{cell.id}/diff?mode=branch")

    assert %{"message" => "Cell is missing base commit metadata"} = json_response(conn, 400)
  end

  test "GET /api/cells/:id/resources returns modeled resource snapshot", %{conn: conn} do
    workspace = workspace!("resources")
    cell = cell!(workspace.id, "resource cell", "ready")

    assert {:ok, _provisioning} =
             Ash.create(
               Provisioning,
               %{cell_id: cell.id, attempt_count: 1, start_mode: "build"},
               domain: Cells
             )

    assert {:ok, service} =
             Ash.create(
               Service,
               %{
                 cell_id: cell.id,
                 name: "api",
                 type: "process",
                 command: "bun run dev",
                 cwd: "/tmp/worktree",
                 env: %{"PORT" => "3000"},
                 definition: %{"name" => "api"}
               },
               domain: Cells
             )

    assert {:ok, _service} =
             Ash.update(
               service,
               %{pid: String.to_integer(System.pid())},
               action: :mark_running,
               domain: Cells
             )

    assert {:ok, _session} =
             Ash.create(
               AgentSession,
               %{cell_id: cell.id, session_id: "session-resources", current_mode: "build"},
               domain: Cells
             )

    assert {:ok, _activity} =
             Ash.create(
               Activity,
               %{
                 cell_id: cell.id,
                 service_id: service.id,
                 type: "service.start",
                 metadata: %{"source" => "test"}
               },
               domain: Cells
             )

    assert {:ok, _timing} =
             Ash.create(
               Timing,
               %{
                 cell_id: cell.id,
                 workflow: "create",
                 run_id: "run-resources",
                 step: "ensure_services",
                 status: "ok",
                 duration_ms: 10,
                 metadata: %{"attempt" => 1}
               },
               domain: Cells
             )

    conn = get(conn, ~p"/api/cells/#{cell.id}/resources")

    assert %{
             "resources" => %{
               "provisioning" => %{"attemptCount" => 1},
               "services" => [%{"id" => service_id, "status" => "running"}],
               "agentSession" => %{"sessionId" => "session-resources"},
               "latestActivity" => %{"type" => "service.start"},
               "latestTiming" => %{"workflow" => "create"}
             },
             "failures" => []
           } = json_response(conn, 200)

    assert service_id == service.id
  end

  test "GET /api/cells/:id/resources returns contract-compatible summary payload", %{conn: conn} do
    workspace = workspace!("resource-summary")
    cell = cell!(workspace.id, "resource summary", "ready")

    assert {:ok, service} =
             Ash.create(
               Service,
               %{
                 cell_id: cell.id,
                 name: "api",
                 type: "process",
                 command: "bun run dev",
                 cwd: "/tmp/worktree",
                 env: %{},
                 definition: %{}
               },
               domain: Cells
             )

    assert {:ok, _service} =
             Ash.update(
               service,
               %{pid: String.to_integer(System.pid())},
               action: :mark_running,
               domain: Cells
             )

    conn =
      get(
        conn,
        ~p"/api/cells/#{cell.id}/resources?includeHistory=true&includeAverages=true&includeRollups=true"
      )

    assert %{
             "cellId" => cell_id,
             "sampledAt" => sampled_at,
             "processCount" => process_count,
             "activeProcessCount" => active_process_count,
             "tracked" => tracked,
             "totalCpuPercent" => _total_cpu_percent,
             "totalRssBytes" => _total_rss_bytes,
             "activeCpuPercent" => _active_cpu_percent,
             "activeRssBytes" => _active_rss_bytes,
             "processes" => [process],
             "history" => history,
             "historyAverages" => history_averages,
             "rollups" => rollups
           } = json_response(conn, 200)

    assert cell_id == cell.id
    assert is_binary(sampled_at)
    assert process_count == 1
    assert active_process_count == 1
    assert tracked["services"] == 1
    assert tracked["opencode"] == 0
    assert tracked["terminal"] == 0
    assert tracked["setup"] == 0

    assert process["id"] == service.id
    assert process["kind"] == "service"
    assert process["serviceType"] == "process"
    assert process["active"] == true
    assert process["processAlive"] == true
    assert process["cpuPercent"] == nil
    assert process["rssBytes"] == nil

    assert length(history) == 1
    assert length(history_averages) == 4
    assert length(rollups) == 1
  end

  test "GET /api/cells/:id/resources surfaces resource failure states", %{conn: conn} do
    workspace = workspace!("resource-failure")
    cell = cell!(workspace.id, "resource failure", "error")

    assert {:ok, service} =
             Ash.create(
               Service,
               %{
                 cell_id: cell.id,
                 name: "api",
                 type: "process",
                 command: "bun run dev",
                 cwd: "/tmp/worktree",
                 env: %{},
                 definition: %{}
               },
               domain: Cells
             )

    assert {:ok, _service} =
             Ash.update(
               service,
               %{last_known_error: "Service crashed"},
               action: :mark_error,
               domain: Cells
             )

    conn = get(conn, ~p"/api/cells/#{cell.id}/resources")

    assert %{"failures" => failures} = json_response(conn, 200)

    assert Enum.any?(failures, &(&1["code"] == "provisioning_missing"))
    assert Enum.any?(failures, &(&1["code"] == "agent_session_missing"))

    assert Enum.any?(failures, fn failure ->
             failure["code"] == "service_error" and failure["serviceId"] == service.id
           end)
  end

  defp workspace!(suffix) do
    assert {:ok, workspace} =
             Ash.create(
               Workspace,
               %{path: "/tmp/controller-workspace-#{suffix}", label: "Workspace #{suffix}"},
               domain: Cells
             )

    workspace
  end

  defp workspace_with_path!(path, suffix) do
    assert {:ok, workspace} =
             Ash.create(
               Workspace,
               %{path: path, label: "Workspace #{suffix}"},
               domain: Cells
             )

    workspace
  end

  defp git_fixture_repo!(suffix) do
    repo_path =
      Path.join(System.tmp_dir!(), "hive-diff-#{suffix}-#{System.unique_integer([:positive])}")

    File.mkdir_p!(repo_path)

    on_exit(fn ->
      File.rm_rf!(repo_path)
    end)

    run_git!(repo_path, ["init"])
    run_git!(repo_path, ["config", "user.name", "Hive Test"])
    run_git!(repo_path, ["config", "user.email", "hive-test@example.com"])

    file_path = Path.join(repo_path, "notes.txt")
    File.write!(file_path, "initial\n")
    run_git!(repo_path, ["add", "notes.txt"])
    run_git!(repo_path, ["commit", "-m", "initial"])

    File.write!(file_path, "updated\n")

    repo_path
  end

  defp run_git!(repo_path, args) do
    {output, 0} = System.cmd("git", args, cd: repo_path, stderr_to_stdout: true)
    output
  end

  defp cell!(workspace_id, description, status) do
    workspace =
      Workspace
      |> Ash.Query.filter(expr(id == ^workspace_id))
      |> Ash.read_one!(domain: Cells)

    assert {:ok, cell} =
             Ash.create(
               Cell,
               %{
                 workspace_id: workspace_id,
                 description: description,
                 status: status,
                 workspace_root_path: workspace.path,
                 workspace_path: workspace.path
               },
               domain: Cells
             )

    cell
  end

  defp ready_session_id(resp_body) do
    ready_event =
      resp_body
      |> String.split("\n\n")
      |> Enum.find(&String.contains?(&1, "event: ready"))

    [data_line] =
      ready_event
      |> String.split("\n")
      |> Enum.filter(&String.starts_with?(&1, "data: "))

    data_line
    |> String.replace_prefix("data: ", "")
    |> Jason.decode!()
    |> Map.fetch!("sessionId")
  end
end

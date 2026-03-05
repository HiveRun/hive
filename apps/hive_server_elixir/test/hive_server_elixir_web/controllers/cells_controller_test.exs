defmodule HiveServerElixirWeb.CellsControllerTest do
  use HiveServerElixirWeb.ConnCase

  import Ash.Expr
  require Ash.Query

  alias Ecto.UUID
  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Activity
  alias HiveServerElixir.Cells.AgentSession
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Lifecycle
  alias HiveServerElixir.Cells.Provisioning
  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.Timing
  alias HiveServerElixir.Cells.Workspace
  alias HiveServerElixir.Opencode.TestOperations

  @registry HiveServerElixir.Opencode.EventIngestRegistry

  setup do
    previous_opts = Application.get_env(:hive_server_elixir, :cell_reactor_runtime_opts)
    Application.put_env(:hive_server_elixir, :cell_reactor_runtime_opts, runtime_opts())

    on_exit(fn ->
      if is_nil(previous_opts) do
        Application.delete_env(:hive_server_elixir, :cell_reactor_runtime_opts)
      else
        Application.put_env(:hive_server_elixir, :cell_reactor_runtime_opts, previous_opts)
      end
    end)

    :ok
  end

  test "POST /api/cells creates a ready cell", %{conn: conn} do
    workspace = workspace!("create")

    conn =
      post(conn, ~p"/api/cells", %{
        "workspaceId" => workspace.id,
        "description" => "API create"
      })

    assert %{"cell" => cell_payload} = json_response(conn, 201)
    assert cell_payload["workspaceId"] == workspace.id
    assert cell_payload["status"] == "ready"
    assert is_binary(cell_payload["id"])

    on_exit(fn ->
      _ =
        Lifecycle.on_cell_delete(%{
          workspace_id: workspace.id,
          cell_id: cell_payload["id"]
        })
    end)
  end

  test "GET /api/cells/workspace/:id/stream emits ready, cell snapshot, and snapshot marker", %{
    conn: conn
  } do
    workspace = workspace!("stream")
    cell = cell!(workspace.id, "stream cell", "ready")

    conn = get(conn, ~p"/api/cells/workspace/#{workspace.id}/stream?initialOnly=true")

    assert conn.status == 200
    assert conn.resp_body =~ "event: ready"
    assert conn.resp_body =~ "event: cell"
    assert conn.resp_body =~ cell.id
    assert conn.resp_body =~ "event: snapshot"
  end

  test "GET /api/cells/workspace/:id/stream returns 404 for unknown workspace", %{conn: conn} do
    conn = get(conn, ~p"/api/cells/workspace/#{UUID.generate()}/stream?initialOnly=true")

    assert %{"error" => %{"code" => "workspace_not_found"}} = json_response(conn, 404)
  end

  test "GET /api/cells/:id/timings/stream emits ready, timing snapshot, and snapshot marker", %{
    conn: conn
  } do
    workspace = workspace!("timing-stream")
    cell = cell!(workspace.id, "timing stream cell", "ready")

    assert {:ok, timing} =
             Ash.create(
               Timing,
               %{
                 cell_id: cell.id,
                 workflow: "create",
                 run_id: "run-timing-stream",
                 step: "ensure_services",
                 status: "ok",
                 duration_ms: 12,
                 metadata: %{"source" => "test"}
               },
               domain: Cells
             )

    conn = get(conn, ~p"/api/cells/#{cell.id}/timings/stream?initialOnly=true")

    assert conn.status == 200
    assert conn.resp_body =~ "event: ready"
    assert conn.resp_body =~ "event: timing"
    assert conn.resp_body =~ timing.id
    assert conn.resp_body =~ "event: snapshot"
  end

  test "GET /api/cells/:id/timings/stream returns 404 for missing cells", %{conn: conn} do
    conn = get(conn, ~p"/api/cells/#{UUID.generate()}/timings/stream?initialOnly=true")

    assert %{"error" => %{"code" => "not_found"}} = json_response(conn, 404)
  end

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
    conn = get(conn, ~p"/api/cells/#{UUID.generate()}/setup/terminal/stream?initialOnly=true")

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
                 command: "bun run dev",
                 cwd: "/tmp/worktree",
                 env: %{},
                 definition: %{},
                 status: "running"
               },
               domain: Cells
             )

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
      post(conn, ~p"/api/cells/#{cell.id}/services/#{UUID.generate()}/terminal/input", %{
        "data" => "hello"
      })

    assert %{"error" => %{"code" => "not_found"}} = json_response(conn, 404)
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

  test "POST /api/cells returns 422 for unknown workspace", %{conn: conn} do
    conn =
      post(conn, ~p"/api/cells", %{
        "workspaceId" => UUID.generate(),
        "description" => "missing workspace"
      })

    assert %{"error" => %{"code" => "lifecycle_failed", "message" => message}} =
             json_response(conn, 422)

    assert is_binary(message)
  end

  test "POST /api/cells/:id/setup/retry returns 400 for invalid ids", %{conn: conn} do
    conn = post(conn, ~p"/api/cells/not-a-uuid/setup/retry", %{})

    assert %{"error" => %{"code" => "invalid_cell_id"}} = json_response(conn, 400)
  end

  test "POST /api/cells/:id/setup/resume returns 404 for missing cells", %{conn: conn} do
    conn = post(conn, ~p"/api/cells/#{UUID.generate()}/setup/resume", %{})

    assert %{"error" => %{"code" => "not_found", "message" => message}} =
             json_response(conn, 404)

    assert is_binary(message)
  end

  test "DELETE /api/cells/:id removes the cell and stops ingest", %{conn: conn} do
    workspace = workspace!("delete")
    cell = cell!(workspace.id, "delete me", "ready")
    context = %{workspace_id: workspace.id, cell_id: cell.id}

    assert {:ok, _pid} = Lifecycle.on_cell_create(context, runtime_opts())
    assert [{_pid, _value}] = Registry.lookup(@registry, {workspace.id, cell.id})

    conn = delete(conn, ~p"/api/cells/#{cell.id}")

    assert %{"cell" => %{"id" => deleted_id}} = json_response(conn, 200)
    assert deleted_id == cell.id
    assert [] = Registry.lookup(@registry, {workspace.id, cell.id})
    assert [] = list_cells_by_id(cell.id)
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
                 definition: %{"name" => "api"},
                 status: "running"
               },
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
                 definition: %{},
                 status: "error",
                 last_known_error: "Service crashed"
               },
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

  defp cell!(workspace_id, description, status) do
    assert {:ok, cell} =
             Ash.create(
               Cell,
               %{workspace_id: workspace_id, description: description, status: status},
               domain: Cells
             )

    cell
  end

  defp list_cells_by_id(cell_id) do
    Cell
    |> Ash.Query.filter(expr(id == ^cell_id))
    |> Ash.read!(domain: Cells)
  end

  defp runtime_opts do
    [
      adapter_opts: [
        operations_module: TestOperations,
        global_event: fn _opts -> {:error, %{type: :transport, reason: :unreachable}} end
      ],
      success_delay_ms: 30_000,
      error_delay_ms: 30_000
    ]
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

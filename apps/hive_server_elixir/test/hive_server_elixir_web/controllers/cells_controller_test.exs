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
  alias HiveServerElixir.Cells.ServiceRuntime
  alias HiveServerElixir.Cells.TerminalRuntime
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

    cell_payload = json_response(conn, 201)
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

  test "GET /api/cells lists non-deleting cells for a workspace", %{conn: conn} do
    workspace = workspace!("index")
    ready_cell = cell!(workspace.id, "index ready", "ready")
    _deleting_cell = cell!(workspace.id, "index deleting", "deleting")

    conn = get(conn, ~p"/api/cells?workspaceId=#{workspace.id}")

    assert %{"cells" => cells} = json_response(conn, 200)
    assert length(cells) == 1
    assert hd(cells)["id"] == ready_cell.id
    assert hd(cells)["name"] == "Cell"
  end

  test "GET /api/cells/:id returns cell detail payload", %{conn: conn} do
    workspace = workspace!("show")
    cell = cell!(workspace.id, "show detail", "ready")

    conn = get(conn, ~p"/api/cells/#{cell.id}?includeSetupLog=false")

    assert payload = json_response(conn, 200)
    assert payload["id"] == cell.id
    assert payload["workspaceId"] == workspace.id
    assert payload["status"] == "ready"
    assert payload["name"] == "Cell"
    assert payload["templateId"] == "default-template"
    assert payload["workspacePath"] == workspace.path
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
                 command: "sleep 5",
                 cwd: "/tmp",
                 env: %{},
                 definition: %{},
                 status: "running"
               },
               domain: Cells
             )

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
      post(conn, ~p"/api/cells/#{cell.id}/services/#{UUID.generate()}/terminal/input", %{
        "data" => "hello"
      })

    assert %{"error" => %{"code" => "not_found"}} = json_response(conn, 404)
  end

  test "POST /api/cells/:id/services/:service_id/start starts service runtime and returns pid", %{
    conn: conn
  } do
    workspace = workspace!("service-start")
    cell = cell!(workspace.id, "service start cell", "ready")

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
                 definition: %{},
                 status: "pending"
               },
               domain: Cells
             )

    on_exit(fn ->
      :ok = ServiceRuntime.stop_cell_services(cell.id)
    end)

    conn = post(conn, ~p"/api/cells/#{cell.id}/services/#{service.id}/start", %{})

    assert %{"id" => returned_id, "status" => "running", "pid" => pid} = json_response(conn, 200)
    assert returned_id == service.id
    assert is_integer(pid)
  end

  test "POST /api/cells/:id/services/:service_id/stop clears runtime pid", %{conn: conn} do
    workspace = workspace!("service-stop")
    cell = cell!(workspace.id, "service stop cell", "ready")

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
                 definition: %{},
                 status: "pending"
               },
               domain: Cells
             )

    on_exit(fn ->
      :ok = ServiceRuntime.stop_cell_services(cell.id)
    end)

    _started = post(conn, ~p"/api/cells/#{cell.id}/services/#{service.id}/start", %{})
    conn = post(conn, ~p"/api/cells/#{cell.id}/services/#{service.id}/stop", %{})

    response = json_response(conn, 200)

    assert %{"id" => returned_id, "status" => "stopped"} = response
    assert returned_id == service.id
    refute Map.has_key?(response, "pid")
  end

  test "POST /api/cells/:id/services/restart returns refreshed services", %{conn: conn} do
    workspace = workspace!("services-restart")
    cell = cell!(workspace.id, "service restart cell", "ready")

    assert {:ok, service_a} =
             Ash.create(
               Service,
               %{
                 cell_id: cell.id,
                 name: "api",
                 type: "process",
                 command: "sleep 5",
                 cwd: "/tmp",
                 env: %{},
                 definition: %{},
                 status: "pending"
               },
               domain: Cells
             )

    assert {:ok, service_b} =
             Ash.create(
               Service,
               %{
                 cell_id: cell.id,
                 name: "worker",
                 type: "process",
                 command: "sleep 5",
                 cwd: "/tmp",
                 env: %{},
                 definition: %{},
                 status: "pending"
               },
               domain: Cells
             )

    on_exit(fn ->
      :ok = ServiceRuntime.stop_cell_services(cell.id)
    end)

    conn = post(conn, ~p"/api/cells/#{cell.id}/services/restart", %{})

    assert %{"services" => services} = json_response(conn, 200)
    assert length(services) == 2

    assert Enum.any?(services, fn service ->
             service["id"] == service_a.id and service["status"] == "running" and
               is_integer(service["pid"])
           end)

    assert Enum.any?(services, fn service ->
             service["id"] == service_b.id and service["status"] == "running" and
               is_integer(service["pid"])
           end)
  end

  test "POST /api/cells/:id/services/:service_id/restart refreshes a single service", %{
    conn: conn
  } do
    workspace = workspace!("service-restart")
    cell = cell!(workspace.id, "service restart single", "ready")

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
                 definition: %{},
                 status: "pending"
               },
               domain: Cells
             )

    on_exit(fn ->
      :ok = ServiceRuntime.stop_cell_services(cell.id)
    end)

    _started = post(conn, ~p"/api/cells/#{cell.id}/services/#{service.id}/start", %{})
    conn = post(conn, ~p"/api/cells/#{cell.id}/services/#{service.id}/restart", %{})

    assert %{"id" => returned_id, "status" => "running", "pid" => pid} = json_response(conn, 200)
    assert returned_id == service.id
    assert is_integer(pid)
  end

  test "GET /api/cells/:id/services returns service runtime parity fields", %{conn: conn} do
    workspace = workspace!("services-index")
    cell = cell!(workspace.id, "service index", "ready")

    assert {:ok, service} =
             Ash.create(
               Service,
               %{
                 cell_id: cell.id,
                 name: "api",
                 type: "process",
                 command: "sleep 5",
                 cwd: "/tmp",
                 env: %{"NODE_ENV" => "test"},
                 definition: %{},
                 status: "pending"
               },
               domain: Cells
             )

    on_exit(fn ->
      :ok = ServiceRuntime.stop_cell_services(cell.id)
    end)

    _started = post(conn, ~p"/api/cells/#{cell.id}/services/#{service.id}/start", %{})
    conn = get(conn, ~p"/api/cells/#{cell.id}/services")

    assert %{"services" => [service_payload]} = json_response(conn, 200)
    assert service_payload["id"] == service.id
    assert service_payload["name"] == "api"
    assert service_payload["type"] == "process"
    assert service_payload["command"] == "sleep 5"
    assert service_payload["cwd"] == "/tmp"
    assert service_payload["env"] == %{"NODE_ENV" => "test"}
    assert service_payload["status"] == "running"
    assert service_payload["processAlive"] == true
    assert service_payload["logPath"] == nil
    assert service_payload["recentLogs"] == nil
    assert service_payload["totalLogLines"] == nil
    assert service_payload["hasMoreLogs"] == false
    assert is_integer(service_payload["pid"])
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
                 definition: %{},
                 status: "pending"
               },
               domain: Cells
             )

    conn = get(conn, ~p"/api/cells/#{cell.id}/services/stream?initialOnly=true")

    assert conn.status == 200
    assert conn.resp_body =~ "event: ready"
    assert conn.resp_body =~ "event: service"
    assert conn.resp_body =~ "event: snapshot"
  end

  test "GET /api/cells/:id/services supports log tail query params", %{conn: conn} do
    workspace = workspace!("services-tail")
    cell = cell!(workspace.id, "service tail", "ready")

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
                 definition: %{},
                 status: "pending"
               },
               domain: Cells
             )

    :ok = TerminalRuntime.append_service_output(cell.id, service.id, "line-1\nline-2\nline-3")

    conn = get(conn, ~p"/api/cells/#{cell.id}/services?logLines=2&logOffset=0")

    assert %{"services" => [service_payload]} = json_response(conn, 200)
    assert service_payload["recentLogs"] == "line-2\nline-3"
    assert service_payload["totalLogLines"] == 3
    assert service_payload["hasMoreLogs"] == true
  end

  test "POST /api/cells/:id/services/start starts all services", %{conn: conn} do
    workspace = workspace!("services-start-all")
    cell = cell!(workspace.id, "service start all", "ready")

    assert {:ok, _service_a} =
             Ash.create(
               Service,
               %{
                 cell_id: cell.id,
                 name: "api",
                 type: "process",
                 command: "sleep 5",
                 cwd: "/tmp",
                 env: %{},
                 definition: %{},
                 status: "pending"
               },
               domain: Cells
             )

    assert {:ok, _service_b} =
             Ash.create(
               Service,
               %{
                 cell_id: cell.id,
                 name: "worker",
                 type: "process",
                 command: "sleep 5",
                 cwd: "/tmp",
                 env: %{},
                 definition: %{},
                 status: "pending"
               },
               domain: Cells
             )

    on_exit(fn ->
      :ok = ServiceRuntime.stop_cell_services(cell.id)
    end)

    conn = post(conn, ~p"/api/cells/#{cell.id}/services/start", %{})
    assert %{"services" => services} = json_response(conn, 200)
    assert length(services) == 2
    assert Enum.all?(services, fn service -> service["status"] == "running" end)
  end

  test "POST /api/cells/:id/services/stop stops all services", %{conn: conn} do
    workspace = workspace!("services-stop-all")
    cell = cell!(workspace.id, "service stop all", "ready")

    assert {:ok, service_a} =
             Ash.create(
               Service,
               %{
                 cell_id: cell.id,
                 name: "api",
                 type: "process",
                 command: "sleep 5",
                 cwd: "/tmp",
                 env: %{},
                 definition: %{},
                 status: "pending"
               },
               domain: Cells
             )

    assert {:ok, service_b} =
             Ash.create(
               Service,
               %{
                 cell_id: cell.id,
                 name: "worker",
                 type: "process",
                 command: "sleep 5",
                 cwd: "/tmp",
                 env: %{},
                 definition: %{},
                 status: "pending"
               },
               domain: Cells
             )

    on_exit(fn ->
      :ok = ServiceRuntime.stop_cell_services(cell.id)
    end)

    _started_api = post(conn, ~p"/api/cells/#{cell.id}/services/#{service_a.id}/start", %{})
    _started_worker = post(conn, ~p"/api/cells/#{cell.id}/services/#{service_b.id}/start", %{})

    conn = post(conn, ~p"/api/cells/#{cell.id}/services/stop", %{})
    assert %{"services" => services} = json_response(conn, 200)
    assert length(services) == 2
    assert Enum.all?(services, fn service -> service["status"] == "stopped" end)
  end

  test "service lifecycle endpoints persist audit header metadata", %{conn: conn} do
    workspace = workspace!("service-audit-headers")
    cell = cell!(workspace.id, "service audit", "ready")

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
                 definition: %{},
                 status: "pending"
               },
               domain: Cells
             )

    on_exit(fn ->
      :ok = ServiceRuntime.stop_cell_services(cell.id)
    end)

    conn =
      conn
      |> put_req_header("x-hive-source", "opencode")
      |> put_req_header("x-hive-tool", "hive-services")
      |> put_req_header("x-hive-audit-event", "manual_start")
      |> put_req_header("x-hive-service-name", "api")

    _started = post(conn, ~p"/api/cells/#{cell.id}/services/#{service.id}/start", %{})
    conn = get(build_conn(), ~p"/api/cells/#{cell.id}/resources")

    assert %{"resources" => %{"latestActivity" => latest_activity}} = json_response(conn, 200)
    assert latest_activity["type"] == "service.start"
    assert latest_activity["source"] == "opencode"
    assert latest_activity["toolName"] == "hive-services"
    assert latest_activity["metadata"]["auditEvent"] == "manual_start"
    assert latest_activity["metadata"]["serviceName"] == "api"
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

  test "POST /api/cells returns 404 for unknown workspace", %{conn: conn} do
    conn =
      post(conn, ~p"/api/cells", %{
        "workspaceId" => UUID.generate(),
        "description" => "missing workspace"
      })

    assert %{"error" => %{"code" => "not_found", "message" => message}} =
             json_response(conn, 404)

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

    assert %{"message" => "Cell deleted successfully"} = json_response(conn, 200)
    assert [] = Registry.lookup(@registry, {workspace.id, cell.id})
    assert [] = list_cells_by_id(cell.id)
  end

  test "DELETE /api/cells returns deletedIds for bulk deletion", %{conn: conn} do
    workspace = workspace!("delete-many")
    cell_a = cell!(workspace.id, "delete many a", "ready")
    cell_b = cell!(workspace.id, "delete many b", "ready")

    conn = delete(conn, ~p"/api/cells", %{"ids" => [cell_a.id, cell_b.id]})

    assert %{"deletedIds" => deleted_ids} = json_response(conn, 200)
    assert Enum.sort(deleted_ids) == Enum.sort([cell_a.id, cell_b.id])
  end

  test "GET /api/cells/:id/activity returns paginated events", %{conn: conn} do
    workspace = workspace!("activity")
    cell = cell!(workspace.id, "activity cell", "ready")

    assert {:ok, _first} =
             Ash.create(Activity, %{cell_id: cell.id, type: "service.start", metadata: %{}},
               domain: Cells
             )

    assert {:ok, _second} =
             Ash.create(Activity, %{cell_id: cell.id, type: "service.stop", metadata: %{}},
               domain: Cells
             )

    conn = get(conn, ~p"/api/cells/#{cell.id}/activity?limit=1")

    assert %{"events" => events, "nextCursor" => next_cursor} = json_response(conn, 200)
    assert length(events) == 1
    assert is_binary(next_cursor)
  end

  test "GET /api/cells/:id/timings and /timings/global return run summaries", %{conn: conn} do
    workspace = workspace!("timings")
    cell = cell!(workspace.id, "timing cell", "ready")

    assert {:ok, _timing} =
             Ash.create(
               Timing,
               %{
                 cell_id: cell.id,
                 cell_name: "timing cell",
                 workspace_id: workspace.id,
                 template_id: "default-template",
                 workflow: "create",
                 run_id: "run-1",
                 step: "ensure_services",
                 status: "ok",
                 duration_ms: 10,
                 metadata: %{}
               },
               domain: Cells
             )

    conn = get(conn, ~p"/api/cells/#{cell.id}/timings")
    assert %{"steps" => steps, "runs" => runs} = json_response(conn, 200)
    assert length(steps) == 1
    assert length(runs) == 1

    conn = get(conn, ~p"/api/cells/timings/global?cellId=#{cell.id}")
    assert %{"steps" => global_steps, "runs" => global_runs} = json_response(conn, 200)
    assert length(global_steps) == 1
    assert length(global_runs) == 1
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
    workspace = workspace!("diff-pending")
    cell = cell!(workspace.id, "diff pending", "pending")

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
                 definition: %{},
                 status: "running",
                 pid: String.to_integer(System.pid())
               },
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

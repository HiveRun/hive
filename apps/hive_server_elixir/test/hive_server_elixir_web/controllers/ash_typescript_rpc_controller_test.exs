defmodule HiveServerElixirWeb.AshTypescriptRpcControllerTest do
  use HiveServerElixirWeb.ConnCase

  import Ash.Expr
  require Ash.Query

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.AgentSession
  alias HiveServerElixir.Cells.Activity
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.CellCommands
  alias HiveServerElixir.Cells.Lifecycle
  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.ServiceRuntime
  alias HiveServerElixir.Cells.TerminalRuntime
  alias HiveServerElixir.Cells.Timing
  alias HiveServerElixir.Cells.Workspace
  alias HiveServerElixir.Workspaces

  @registry HiveServerElixir.Opencode.EventIngestRegistry

  setup do
    previous_active_workspace_id = Workspaces.active_workspace_id()
    previous_runtime_opts = Application.get_env(:hive_server_elixir, :cell_reactor_runtime_opts)

    cleanup_terminal_runtime!()

    Workspace
    |> Ash.read!(domain: Cells)
    |> Enum.each(&destroy_workspace_with_retry!/1)

    :ok = Workspaces.set_active_workspace_id(nil)
    Application.put_env(:hive_server_elixir, :cell_reactor_runtime_opts, runtime_opts())

    on_exit(fn ->
      cleanup_terminal_runtime!()
      :ok = Workspaces.set_active_workspace_id(previous_active_workspace_id)

      if is_nil(previous_runtime_opts) do
        Application.delete_env(:hive_server_elixir, :cell_reactor_runtime_opts)
      else
        Application.put_env(
          :hive_server_elixir,
          :cell_reactor_runtime_opts,
          previous_runtime_opts
        )
      end
    end)

    :ok
  end

  defp cleanup_terminal_runtime! do
    Cell
    |> Ash.read!(domain: Cells)
    |> Enum.each(fn cell ->
      :ok = ServiceRuntime.stop_cell_services(cell.id)
      :ok = TerminalRuntime.clear_cell(cell.id)
    end)
  end

  defp destroy_workspace_with_retry!(workspace, attempts_left \\ 5)

  defp destroy_workspace_with_retry!(workspace, attempts_left) when attempts_left > 1 do
    Ash.destroy(workspace, domain: Cells)
    |> case do
      :ok ->
        :ok

      {:ok, _destroyed} ->
        :ok

      {:error, error} ->
        if String.contains?(inspect(error), "Database busy") do
          Process.sleep(100)
          destroy_workspace_with_retry!(workspace, attempts_left - 1)
        else
          Ash.destroy!(workspace, domain: Cells)
        end
    end
  end

  defp destroy_workspace_with_retry!(workspace, _attempts_left) do
    Ash.destroy!(workspace, domain: Cells)
  end

  test "list_workspaces returns Ash-backed workspace records", %{conn: conn} do
    older = workspace!("rpc-older")
    newer = workspace!("rpc-newer")
    :ok = Workspaces.set_active_workspace_id(newer.id)

    payload =
      rpc_run(conn, "list_workspaces", %{
        "fields" => ["id", "path", "label", "lastOpenedAt", "insertedAt"]
      })

    assert payload["success"] == true
    assert [first | _rest] = payload["data"]
    assert first["id"] == newer.id
    assert first["path"] == newer.path
    assert is_binary(first["insertedAt"])
    assert is_binary(first["lastOpenedAt"])

    assert Enum.any?(payload["data"], fn workspace -> workspace["id"] == older.id end)
  end

  test "register_workspace creates a workspace and activates it when none is active", %{
    conn: conn
  } do
    workspace_path = workspace_dir!("rpc-register")

    payload =
      rpc_run(conn, "register_workspace", %{
        "input" => %{"path" => workspace_path},
        "fields" => ["id", "path", "label", "lastOpenedAt", "insertedAt"]
      })

    assert payload["success"] == true
    assert payload["data"]["path"] == workspace_path
    assert payload["data"]["label"] == Path.basename(workspace_path)
    assert is_binary(payload["data"]["lastOpenedAt"])
    assert payload["data"]["id"] == Workspaces.active_workspace_id()
  end

  test "activate_workspace updates the active workspace timestamp", %{conn: conn} do
    first = workspace!("rpc-activate-first")
    second = workspace!("rpc-activate-second")
    :ok = Workspaces.set_active_workspace_id(first.id)

    payload =
      rpc_run(conn, "activate_workspace", %{
        "identity" => second.id,
        "fields" => ["id", "path", "label", "lastOpenedAt"]
      })

    assert payload["success"] == true
    assert payload["data"]["id"] == second.id
    assert is_binary(payload["data"]["lastOpenedAt"])
    assert Workspaces.active_workspace_id() == second.id
  end

  test "delete_workspace removes an existing workspace", %{conn: conn} do
    workspace = workspace!("rpc-delete")
    :ok = Workspaces.set_active_workspace_id(workspace.id)

    payload = rpc_run(conn, "delete_workspace", %{"identity" => workspace.id})

    assert payload["success"] == true
    assert payload["data"] == %{}
    assert Workspaces.list() == []
    assert Workspaces.active_workspace_id() == nil
  end

  test "get_agent_session_by_cell returns the serialized session payload", %{conn: conn} do
    workspace = workspace!("rpc-agent-session")
    cell = cell!(workspace, "ready")
    agent_session = agent_session!(cell)

    payload =
      rpc_run(conn, "get_agent_session_by_cell", %{
        "input" => %{"cellId" => cell.id},
        "fields" => [
          "id",
          "cellId",
          "templateId",
          "provider",
          "status",
          "workspacePath",
          "createdAt",
          "updatedAt",
          "modelId",
          "modelProviderId",
          "startMode",
          "currentMode",
          "modeUpdatedAt"
        ]
      })

    assert payload["success"] == true
    assert payload["data"]["id"] == agent_session.session_id
    assert payload["data"]["cellId"] == cell.id
    assert payload["data"]["templateId"] == cell.template_id
    assert payload["data"]["provider"] == "opencode"
    assert payload["data"]["status"] == "awaiting_input"
    assert payload["data"]["workspacePath"] == cell.workspace_path
    assert payload["data"]["modelId"] == "big-pickle"
    assert payload["data"]["modelProviderId"] == "opencode"
    assert payload["data"]["startMode"] == "plan"
    assert payload["data"]["currentMode"] == "build"
    assert is_binary(payload["data"]["createdAt"])
    assert is_binary(payload["data"]["updatedAt"])
    assert is_binary(payload["data"]["modeUpdatedAt"])
  end

  test "get_agent_session_by_cell returns an empty payload when no session exists", %{conn: conn} do
    workspace = workspace!("rpc-agent-session-empty")
    cell = cell!(workspace, "ready")

    payload =
      rpc_run(conn, "get_agent_session_by_cell", %{
        "input" => %{"cellId" => cell.id},
        "fields" => ["id", "cellId", "currentMode"]
      })

    assert payload["success"] == true
    assert payload["data"] == %{"cellId" => nil, "currentMode" => nil, "id" => nil}
  end

  test "set_agent_session_mode updates the serialized session payload", %{conn: conn} do
    workspace = workspace!("rpc-agent-mode")
    cell = cell!(workspace, "ready")
    agent_session = agent_session!(cell)

    payload =
      rpc_run(conn, "set_agent_session_mode", %{
        "input" => %{"sessionId" => agent_session.session_id, "mode" => "plan"},
        "fields" => ["id", "currentMode", "startMode", "modeUpdatedAt"]
      })

    assert payload["success"] == true
    assert payload["data"]["id"] == agent_session.session_id
    assert payload["data"]["startMode"] == "plan"
    assert payload["data"]["currentMode"] == "plan"
    assert is_binary(payload["data"]["modeUpdatedAt"])
  end

  test "list_cells and get_cell return Ash-backed cell records", %{conn: conn} do
    workspace = workspace!("rpc-cells")
    cell = cell!(workspace, "ready")
    _deleting_cell = cell!(workspace, "deleting")

    list_payload =
      rpc_run(conn, "list_cells", %{
        "input" => %{"workspaceId" => workspace.id},
        "fields" => ["id", "workspaceId", "name", "status", "workspacePath", "insertedAt"]
      })

    assert list_payload["success"] == true
    assert [%{"id" => returned_id, "status" => "ready"}] = list_payload["data"]
    assert returned_id == cell.id

    get_payload =
      rpc_run(conn, "get_cell", %{
        "input" => %{"id" => cell.id},
        "fields" => [
          "id",
          "workspaceId",
          "templateId",
          "workspacePath",
          "workspaceRootPath",
          "status"
        ]
      })

    assert get_payload["success"] == true
    assert get_payload["data"]["id"] == cell.id
    assert get_payload["data"]["workspaceId"] == workspace.id
    assert get_payload["data"]["workspacePath"] == workspace.path
    assert get_payload["data"]["workspaceRootPath"] == workspace.path
    assert get_payload["data"]["templateId"] == "default-template"
  end

  test "create_cell returns a provisioning payload immediately", %{conn: conn} do
    workspace = workspace!("rpc-create-cell")

    payload =
      rpc_run(conn, "create_cell", %{
        "input" => %{"workspaceId" => workspace.id, "description" => "RPC create"},
        "fields" => ["id", "workspaceId", "status", "lastSetupError", "opencodeCommand"]
      })

    assert payload["success"] == true
    assert payload["data"]["workspaceId"] == workspace.id
    assert payload["data"]["status"] == "provisioning"
    assert is_binary(payload["data"]["id"])
    assert is_binary(payload["data"]["opencodeCommand"])

    assert {:ok, refreshed_cell} = Ash.get(Cell, payload["data"]["id"], domain: Cells)
    assert refreshed_cell.status in [:provisioning, :ready]

    on_exit(fn ->
      _ =
        Lifecycle.on_cell_delete(%{
          workspace_id: workspace.id,
          cell_id: payload["data"]["id"]
        })
    end)
  end

  test "retry_cell_setup records retry activity and returns a provisioning payload", %{conn: conn} do
    workspace = workspace!("rpc-retry-cell")
    cell = created_cell!(workspace)

    payload =
      rpc_run(conn, "retry_cell_setup", %{
        "input" => %{"cellId" => cell.id},
        "fields" => ["id", "status", "lastSetupError"]
      })

    assert payload["success"] == true
    assert payload["data"]["id"] == cell.id
    assert payload["data"]["status"] == "provisioning"

    activity_events =
      Activity
      |> Ash.Query.filter(expr(cell_id == ^cell.id and type == "setup.retry"))
      |> Ash.read!(domain: Cells)

    assert length(activity_events) == 1
  end

  test "resume_cell_setup returns a provisioning cell payload", %{conn: conn} do
    workspace = workspace!("rpc-resume-cell")
    cell = created_cell!(workspace)

    payload =
      rpc_run(conn, "resume_cell_setup", %{
        "input" => %{"cellId" => cell.id},
        "fields" => ["id", "status"]
      })

    assert payload["success"] == true
    assert payload["data"]["id"] == cell.id
    assert payload["data"]["status"] == "provisioning"
  end

  test "delete_cell removes the cell and stops ingest", %{conn: conn} do
    workspace = workspace!("rpc-delete-cell")
    cell = cell!(workspace, "ready")
    context = %{workspace_id: workspace.id, cell_id: cell.id}

    assert {:ok, _pid} =
             Lifecycle.on_cell_create(
               context,
               Application.fetch_env!(:hive_server_elixir, :cell_reactor_runtime_opts)
             )

    assert [{_pid, _value}] = Registry.lookup(@registry, {workspace.id, cell.id})

    payload =
      rpc_run(conn, "delete_cell", %{
        "input" => %{"cellId" => cell.id},
        "fields" => ["deletedId", "workspaceId"]
      })

    assert payload["success"] == true
    assert payload["data"]["deletedId"] == cell.id
    assert payload["data"]["workspaceId"] == workspace.id
    assert [] = Registry.lookup(@registry, {workspace.id, cell.id})
    assert [] = list_cells_by_id(cell.id)
  end

  test "delete_many_cells returns deleted and failed ids", %{conn: conn} do
    workspace = workspace!("rpc-delete-many-cells")
    cell_a = cell!(workspace, "ready")
    cell_b = cell!(workspace, "ready")
    missing_id = Ecto.UUID.generate()

    payload =
      rpc_run(conn, "delete_many_cells", %{
        "input" => %{"ids" => [cell_a.id, cell_b.id, missing_id]},
        "fields" => ["deletedIds", "failedIds"]
      })

    assert payload["success"] == true
    assert Enum.sort(payload["data"]["deletedIds"]) == Enum.sort([cell_a.id, cell_b.id])
    assert payload["data"]["failedIds"] == [missing_id]
  end

  test "list_services returns typed service snapshots with optional resources/log tail", %{
    conn: conn
  } do
    workspace = workspace!("rpc-services-list")
    cell = cell!(workspace, "ready")
    service = service!(cell, %{env: %{"NODE_ENV" => "test"}})

    :ok = TerminalRuntime.append_service_output(cell.id, service.id, "line-1\nline-2\nline-3")

    payload =
      rpc_run(conn, "list_services", %{
        "input" => %{
          "cellId" => cell.id,
          "includeResources" => true,
          "logLines" => 2,
          "logOffset" => 0
        },
        "fields" => [
          "id",
          "name",
          "env",
          "recentLogs",
          "totalLogLines",
          "hasMoreLogs",
          "cpuPercent",
          "rssBytes",
          "resourceSampledAt",
          "resourceUnavailableReason"
        ]
      })

    assert payload["success"] == true
    assert [service_payload] = payload["data"]
    assert service_payload["id"] == service.id
    assert service_payload["name"] == service.name
    assert service_payload["env"] == %{"NODE_ENV" => "test"}
    assert service_payload["recentLogs"] == "line-2\nline-3"
    assert service_payload["totalLogLines"] == 3
    assert service_payload["hasMoreLogs"] == true
    assert is_binary(service_payload["resourceSampledAt"])
  end

  test "list_terminal_sessions returns typed terminal session records", %{conn: conn} do
    workspace = workspace!("rpc-terminal-sessions")
    cell = cell!(workspace, "ready")
    service = service!(cell)

    assert {:ok, setup_session} = TerminalRuntime.ensure_setup_session(cell.id)
    assert {:ok, service_session} = TerminalRuntime.ensure_service_session(cell.id, service.id)

    payload =
      rpc_run(conn, "list_terminal_sessions", %{
        "input" => %{"cellId" => cell.id},
        "fields" => ["kind", "status", "runtimeSessionId", "cellId", "serviceId"]
      })

    assert payload["success"] == true

    assert Enum.sort_by(payload["data"], & &1["kind"]) ==
             [
               %{
                 "cellId" => cell.id,
                 "kind" => "service",
                 "runtimeSessionId" => service_session.sessionId,
                 "serviceId" => service.id,
                 "status" => "running"
               },
               %{
                 "cellId" => cell.id,
                 "kind" => "setup",
                 "runtimeSessionId" => setup_session.sessionId,
                 "serviceId" => nil,
                 "status" => "running"
               }
             ]
  end

  test "service lifecycle RPC actions update runtime-backed snapshots", %{conn: conn} do
    workspace = workspace!("rpc-service-lifecycle")
    cell = cell!(workspace, "ready")
    service = service!(cell)

    start_payload =
      rpc_run(conn, "start_service", %{
        "input" => %{"serviceId" => service.id},
        "fields" => ["id", "status", "pid", "processAlive"]
      })

    assert start_payload["success"] == true
    assert start_payload["data"]["id"] == service.id
    assert start_payload["data"]["status"] == "running"
    assert is_integer(start_payload["data"]["pid"])
    assert start_payload["data"]["processAlive"] == true

    restart_payload =
      rpc_run(conn, "restart_service", %{
        "input" => %{"serviceId" => service.id},
        "fields" => ["id", "status", "pid"]
      })

    assert restart_payload["success"] == true
    assert restart_payload["data"]["id"] == service.id
    assert_eventually_service_status(conn, cell.id, service.id, "running")

    stop_payload =
      rpc_run(conn, "stop_service", %{
        "input" => %{"serviceId" => service.id},
        "fields" => ["id", "status", "pid"]
      })

    assert stop_payload["success"] == true
    assert stop_payload["data"]["id"] == service.id
    assert stop_payload["data"]["status"] == "stopped"
    assert stop_payload["data"]["pid"] == nil
  end

  test "bulk service lifecycle RPC actions return refreshed snapshots", %{conn: conn} do
    workspace = workspace!("rpc-services-bulk")
    cell = cell!(workspace, "ready")
    service_a = service!(cell, %{name: "api"})
    service_b = service!(cell, %{name: "worker"})

    start_payload =
      rpc_run(conn, "start_services", %{
        "input" => %{"cellId" => cell.id},
        "fields" => ["id", "status"]
      })

    assert start_payload["success"] == true

    assert Enum.sort(Enum.map(start_payload["data"], & &1["id"])) ==
             Enum.sort([service_a.id, service_b.id])

    assert Enum.all?(start_payload["data"], &(&1["status"] == "running"))

    restart_payload =
      rpc_run(conn, "restart_services", %{
        "input" => %{"cellId" => cell.id},
        "fields" => ["id", "status", "pid"]
      })

    assert restart_payload["success"] == true

    assert_eventually_services_status(
      conn,
      cell.id,
      %{service_a.id => "running", service_b.id => "running"}
    )

    stop_payload =
      rpc_run(conn, "stop_services", %{
        "input" => %{"cellId" => cell.id},
        "fields" => ["id", "status", "pid"]
      })

    assert stop_payload["success"] == true

    assert_eventually_services_status(
      conn,
      cell.id,
      %{service_a.id => "stopped", service_b.id => "stopped"}
    )
  end

  test "service lifecycle RPC actions persist audit metadata", %{conn: conn} do
    workspace = workspace!("rpc-service-audit")
    cell = cell!(workspace, "ready")
    service = service!(cell)

    payload =
      rpc_run(conn, "start_service", %{
        "input" => %{
          "serviceId" => service.id,
          "source" => "opencode",
          "toolName" => "hive-services",
          "auditEvent" => "manual_start",
          "serviceName" => "api"
        },
        "fields" => ["id", "status"]
      })

    assert payload["success"] == true

    latest_activity =
      Activity
      |> Ash.Query.filter(expr(cell_id == ^cell.id and type == "service.start"))
      |> Ash.Query.sort(inserted_at: :desc)
      |> Ash.Query.limit(1)
      |> Ash.read!(domain: Cells)
      |> List.first()

    assert latest_activity.source == "opencode"
    assert latest_activity.tool_name == "hive-services"
    assert latest_activity.metadata["auditEvent"] == "manual_start"
    assert latest_activity.metadata["serviceName"] == "api"
  end

  test "list_cell_activity returns raw activity records", %{conn: conn} do
    workspace = workspace!("rpc-activity")
    cell = cell!(workspace, "ready")

    assert {:ok, _activity} =
             Ash.create(Activity, %{cell_id: cell.id, type: "service.start", metadata: %{}},
               domain: Cells
             )

    payload =
      rpc_run(conn, "list_cell_activity", %{
        "input" => %{"cellId" => cell.id, "limit" => 5},
        "fields" => ["id", "cellId", "type", "insertedAt"]
      })

    assert payload["success"] == true

    assert [
             %{
               "cellId" => returned_cell_id,
               "type" => "service.start",
               "insertedAt" => inserted_at
             }
           ] =
             payload["data"]

    assert returned_cell_id == cell.id
    assert is_binary(inserted_at)
  end

  test "list timing actions return raw timing records", %{conn: conn} do
    workspace = workspace!("rpc-timings")
    cell = cell!(workspace, "ready")

    assert {:ok, _timing} =
             Ash.create(
               Timing,
               %{
                 cell_id: cell.id,
                 cell_name: "Cell",
                 workspace_id: workspace.id,
                 template_id: "default-template",
                 workflow: "create",
                 run_id: "run-rpc",
                 step: "ensure_services",
                 status: "ok",
                 duration_ms: 10,
                 metadata: %{}
               },
               domain: Cells
             )

    fields = [
      "id",
      "cellId",
      "workspaceId",
      "workflow",
      "runId",
      "step",
      "status",
      "durationMs",
      "insertedAt"
    ]

    cell_payload =
      rpc_run(conn, "list_cell_timings", %{
        "input" => %{"cellId" => cell.id, "limit" => 10},
        "fields" => fields
      })

    assert cell_payload["success"] == true
    assert [%{"cellId" => returned_cell_id, "runId" => "run-rpc"}] = cell_payload["data"]
    assert returned_cell_id == cell.id

    global_payload =
      rpc_run(conn, "list_global_cell_timings", %{
        "input" => %{"cellId" => cell.id, "limit" => 10},
        "fields" => fields
      })

    assert global_payload["success"] == true

    assert [%{"workspaceId" => returned_workspace_id, "runId" => "run-rpc"}] =
             global_payload["data"]

    assert returned_workspace_id == workspace.id
  end

  defp rpc_run(conn, action, payload) do
    conn = post(conn, ~p"/rpc/run", Map.put(payload, "action", action))
    json_response(conn, 200)
  end

  defp workspace!(suffix) do
    path = workspace_dir!(suffix)

    assert {:ok, workspace} =
             Ash.create(
               Workspace,
               %{path: path, label: "Workspace #{suffix}"},
               domain: Cells
             )

    workspace
  end

  defp workspace_dir!(suffix) do
    path =
      Path.join(System.tmp_dir!(), "hive-rpc-#{suffix}-#{System.unique_integer([:positive])}")

    File.mkdir_p!(path)
    File.write!(Path.join(path, "hive.config.json"), "{}")

    on_exit(fn ->
      File.rm_rf!(path)
    end)

    path
  end

  defp cell!(workspace, status) do
    assert {:ok, cell} =
             Ash.create(
               Cell,
               %{
                 workspace_id: workspace.id,
                 name: "Cell",
                 template_id: "default-template",
                 workspace_root_path: workspace.path,
                 workspace_path: workspace.path,
                 status: status
               },
               domain: Cells
             )

    cell
  end

  defp agent_session!(cell) do
    assert {:ok, session} =
             Ash.create(
               AgentSession,
               %{
                 cell_id: cell.id,
                 session_id: "session-#{System.unique_integer([:positive])}",
                 model_id: "big-pickle",
                 model_provider_id: "opencode",
                 start_mode: "plan",
                 current_mode: "build"
               },
               domain: Cells
             )

    session
  end

  defp service!(cell, overrides \\ %{}) do
    attrs =
      Map.merge(
        %{
          cell_id: cell.id,
          name: "api",
          type: "process",
          command: "sleep 5",
          cwd: "/tmp",
          env: %{},
          definition: %{}
        },
        overrides
      )

    assert {:ok, service} = Ash.create(Service, attrs, domain: Cells)

    on_exit(fn ->
      :ok = ServiceRuntime.stop_cell_services(cell.id)
    end)

    service
  end

  defp assert_eventually_service_status(_conn, _cell_id, service_id, expected_status) do
    deadline = System.monotonic_time(:millisecond) + 2_000
    do_assert_eventually_service_status(service_id, expected_status, deadline)
  end

  defp assert_eventually_services_status(_conn, _cell_id, expected_statuses) do
    deadline = System.monotonic_time(:millisecond) + 2_000
    do_assert_eventually_services_status(expected_statuses, deadline)
  end

  defp do_assert_eventually_service_status(service_id, expected_status, deadline) do
    cond do
      match?({:ok, %Service{}}, Ash.get(Service, service_id, domain: Cells)) ->
        {:ok, service} = Ash.get(Service, service_id, domain: Cells)

        if to_string(service.status) == expected_status do
          assert service.pid == nil or is_integer(service.pid)
        else
          if System.monotonic_time(:millisecond) >= deadline do
            flunk("service #{service_id} did not reach #{expected_status}")
          else
            Process.sleep(50)
            do_assert_eventually_service_status(service_id, expected_status, deadline)
          end
        end

      System.monotonic_time(:millisecond) >= deadline ->
        flunk("service #{service_id} did not reach #{expected_status}")

      true ->
        Process.sleep(50)
        do_assert_eventually_service_status(service_id, expected_status, deadline)
    end
  end

  defp do_assert_eventually_services_status(expected_statuses, deadline) do
    matches? =
      Enum.all?(expected_statuses, fn {service_id, expected_status} ->
        case Ash.get(Service, service_id, domain: Cells) do
          {:ok, %Service{status: status, pid: pid}} ->
            to_string(status) == expected_status && (pid == nil or is_integer(pid))

          _other ->
            false
        end
      end)

    cond do
      matches? ->
        :ok

      System.monotonic_time(:millisecond) >= deadline ->
        flunk("services did not reach expected statuses")

      true ->
        Process.sleep(50)
        do_assert_eventually_services_status(expected_statuses, deadline)
    end
  end

  defp created_cell!(workspace) do
    assert {:ok, cell} =
             CellCommands.create(%{
               workspace_id: workspace.id,
               name: "Cell",
               description: nil,
               template_id: "default-template",
               start_mode: "plan",
               workspace_root_path: workspace.path,
               workspace_path: workspace.path,
               runtime_opts:
                 Application.fetch_env!(:hive_server_elixir, :cell_reactor_runtime_opts),
               fail_after_ingest: false
             })

    on_exit(fn ->
      _ =
        Lifecycle.on_cell_delete(%{
          workspace_id: workspace.id,
          cell_id: cell.id
        })
    end)

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
        global_event: fn _opts -> {:error, %{type: :transport, reason: :unreachable}} end
      ],
      success_delay_ms: 30_000,
      error_delay_ms: 30_000
    ]
  end
end

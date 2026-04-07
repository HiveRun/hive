defmodule HiveServerElixirWeb.TerminalChannelTest do
  use HiveServerElixirWeb.ChannelCase, async: false

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Events
  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.ServiceRuntime
  alias HiveServerElixir.Cells.Workspace
  alias HiveServerElixir.Opencode.ServerManager
  alias HiveServerElixirWeb.TerminalChannel
  alias HiveServerElixirWeb.TerminalSocket

  setup do
    {:ok, socket} = connect(TerminalSocket, %{})
    {:ok, socket: socket}
  end

  test "setup terminal channel emits ready/snapshot and input data", %{socket: socket} do
    workspace = workspace!("setup-channel")
    cell = cell!(workspace.id, "setup cell", "provisioning")

    {:ok, _reply, socket} =
      subscribe_and_join(socket, TerminalChannel, "setup_terminal:#{cell.id}")

    assert_push("terminal_event", %{type: "ready", session: _session, setupState: "running"})
    assert_push("terminal_event", %{type: "snapshot", output: _output})

    push(socket, "terminal_message", %{"type" => "input", "data" => "echo setup\n"})
    assert_terminal_chunk_matches("echo setup")

    push(socket, "terminal_message", %{"type" => "ping"})
    assert_push("terminal_event", %{type: "pong"})
  end

  test "service terminal channel forwards pubsub data events", %{socket: socket} do
    workspace = workspace!("service-channel")
    cell = cell!(workspace.id, "service cell", "ready")

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

    {:ok, _reply, _socket} =
      subscribe_and_join(
        socket,
        TerminalChannel,
        "service_terminal:#{cell.id}:#{service.id}"
      )

    assert_push("terminal_event", %{type: "ready", session: _session})
    assert_push("terminal_event", %{type: "snapshot", output: _output})

    assert :ok = Events.publish_service_terminal_data(cell.id, service.id, "svc-line")
    assert_push("terminal_event", %{type: "data", chunk: "svc-line"})
  end

  test "chat terminal channel rejects non-ready cells", %{socket: socket} do
    workspace = workspace!("chat-conflict")
    cell = cell!(workspace.id, "chat cell", "provisioning")

    assert {:error, %{reason: "Chat terminal is unavailable until provisioning completes"}} =
             subscribe_and_join(socket, TerminalChannel, "chat_terminal:#{cell.id}")
  end

  test "chat terminal channel restart emits ready and snapshot", %{socket: socket} do
    start_supervised!({ServerManager, name: ServerManager, timeout_ms: 15_000})

    workspace = workspace!("chat-restart")
    cell = cell!(workspace.id, "chat cell", "ready")

    {:ok, _reply, socket} =
      subscribe_and_join(socket, TerminalChannel, "chat_terminal:#{cell.id}")

    assert_push("terminal_event", %{type: "ready", session: %{sessionId: first_session_id}})
    assert_push("terminal_event", %{type: "snapshot", output: _output})

    push(socket, "terminal_message", %{"type" => "restart"})

    assert_push(
      "terminal_event",
      %{type: "ready", session: %{sessionId: second_session_id}},
      15_000
    )

    assert_push("terminal_event", %{type: "snapshot", output: ""}, 15_000)

    refute first_session_id == second_session_id
  end

  defp workspace!(suffix) do
    path = "/tmp/ws-#{suffix}-#{System.unique_integer([:positive])}"
    File.mkdir_p!(path)

    assert {:ok, workspace} =
             Ash.create(
               Workspace,
               %{path: path, label: "Workspace #{suffix}"},
               domain: Cells
             )

    on_exit(fn ->
      _ = File.rm_rf(path)
    end)

    workspace
  end

  defp assert_terminal_chunk_matches(expected, attempts_left \\ 10)

  defp assert_terminal_chunk_matches(_expected, 0) do
    flunk("terminal never emitted expected chunk")
  end

  defp assert_terminal_chunk_matches(expected, attempts_left) do
    assert_push("terminal_event", %{type: "data", chunk: chunk}, 1_000)

    if String.contains?(chunk, expected) do
      assert chunk =~ expected
    else
      assert_terminal_chunk_matches(expected, attempts_left - 1)
    end
  end

  defp cell!(workspace_id, description, status) do
    {:ok, workspace} = Ash.get(Workspace, workspace_id, domain: Cells)

    assert {:ok, cell} =
             Ash.create(
               Cell,
               %{
                 workspace_id: workspace_id,
                 description: description,
                 name: description,
                 template_id: "basic",
                 workspace_root_path: workspace.path,
                 workspace_path: workspace.path,
                 opencode_session_id: "session-#{System.unique_integer([:positive])}",
                 resume_agent_session_on_startup: true,
                 status: status
               },
               domain: Cells
             )

    cell
  end
end

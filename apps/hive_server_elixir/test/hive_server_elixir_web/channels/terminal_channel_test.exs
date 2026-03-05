defmodule HiveServerElixirWeb.TerminalChannelTest do
  use HiveServerElixirWeb.ChannelCase, async: false

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Events
  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.Workspace
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

    push(socket, "terminal_message", %{"type" => "input", "data" => "echo setup"})
    assert_push("terminal_event", %{type: "data", chunk: "echo setup"})

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
                 command: "printf 'service boot\\n'",
                 cwd: "/tmp",
                 env: %{},
                 definition: %{},
                 status: "running"
               },
               domain: Cells
             )

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
    workspace = workspace!("chat-restart")
    cell = cell!(workspace.id, "chat cell", "ready")

    {:ok, _reply, socket} =
      subscribe_and_join(socket, TerminalChannel, "chat_terminal:#{cell.id}")

    assert_push("terminal_event", %{type: "ready", session: %{sessionId: first_session_id}})
    assert_push("terminal_event", %{type: "snapshot", output: _output})

    push(socket, "terminal_message", %{"type" => "restart"})

    assert_push("terminal_event", %{type: "ready", session: %{sessionId: second_session_id}})
    assert_push("terminal_event", %{type: "snapshot", output: []})

    refute first_session_id == second_session_id
  end

  defp workspace!(suffix) do
    assert {:ok, workspace} =
             Ash.create(
               Workspace,
               %{path: "/tmp/ws-#{suffix}", label: "Workspace #{suffix}"},
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
end

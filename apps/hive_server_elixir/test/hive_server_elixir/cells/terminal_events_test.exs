defmodule HiveServerElixir.Cells.TerminalEventsTest do
  use HiveServerElixir.DataCase, async: false

  alias HiveServerElixir.Cells.Events
  alias HiveServerElixir.Cells.TerminalEvents
  alias HiveServerElixir.Cells.TerminalRuntime

  test "on_cell_started initializes setup terminal output" do
    cell_id = "cell-started-" <> Ash.UUID.generate()
    context = %{workspace_id: "workspace-started", cell_id: cell_id}

    assert :ok = Events.subscribe_setup_terminal(cell_id)
    assert :ok = TerminalEvents.on_cell_started(context)

    assert_receive {:setup_terminal_data,
                    %{cell_id: ^cell_id, chunk: "[hive] provisioning started\n"}}

    assert ["[hive] provisioning started\n"] = TerminalRuntime.read_setup_output(cell_id)

    assert :ok = TerminalRuntime.clear_cell(cell_id)
  end

  test "on_cell_ready emits completion data and setup exit" do
    cell_id = "cell-ready-" <> Ash.UUID.generate()
    context = %{workspace_id: "workspace-ready", cell_id: cell_id}

    assert :ok = Events.subscribe_setup_terminal(cell_id)
    assert :ok = TerminalEvents.on_cell_started(context)
    assert_receive {:setup_terminal_data, %{cell_id: ^cell_id, chunk: _chunk}}

    assert :ok = TerminalEvents.on_cell_ready(context)

    assert_receive {:setup_terminal_data,
                    %{cell_id: ^cell_id, chunk: "[hive] provisioning completed\n"}}

    assert_receive {:setup_terminal_exit, %{cell_id: ^cell_id, exit_code: 0, signal: nil}}

    assert :ok = TerminalRuntime.clear_cell(cell_id)
  end

  test "project_opencode_event forwards chat deltas" do
    cell_id = "cell-chat-delta-" <> Ash.UUID.generate()
    context = %{workspace_id: "workspace-chat", cell_id: cell_id}

    assert :ok = Events.subscribe_chat_terminal(cell_id)

    assert :ok =
             TerminalEvents.project_opencode_event(context, %{
               "payload" => %{
                 "type" => "message.part.delta",
                 "properties" => %{"field" => "text", "delta" => "hello"}
               }
             })

    assert_receive {:chat_terminal_data, %{cell_id: ^cell_id, chunk: "hello"}}
    assert ["hello"] = TerminalRuntime.read_chat_output(cell_id)

    assert :ok = TerminalRuntime.clear_cell(cell_id)
  end

  test "project_opencode_event forwards session and pty terminal events" do
    cell_id = "cell-chat-errors-" <> Ash.UUID.generate()
    context = %{workspace_id: "workspace-chat", cell_id: cell_id}

    assert :ok = Events.subscribe_chat_terminal(cell_id)

    assert :ok =
             TerminalEvents.project_opencode_event(context, %{
               "payload" => %{
                 "type" => "session.error",
                 "properties" => %{"message" => "agent crashed"}
               }
             })

    assert_receive {:chat_terminal_error, %{cell_id: ^cell_id, message: "agent crashed"}}

    assert :ok =
             TerminalEvents.project_opencode_event(context, %{
               "payload" => %{
                 "type" => "pty.exited",
                 "properties" => %{"exitCode" => 137}
               }
             })

    assert_receive {:chat_terminal_exit, %{cell_id: ^cell_id, exit_code: 137, signal: nil}}

    assert :ok = TerminalRuntime.clear_cell(cell_id)
  end

  test "on_cell_stopped emits terminal exits and clears buffered output" do
    cell_id = "cell-stopped-" <> Ash.UUID.generate()
    context = %{workspace_id: "workspace-stop", cell_id: cell_id}

    assert :ok = Events.subscribe_setup_terminal(cell_id)
    assert :ok = Events.subscribe_chat_terminal(cell_id)

    assert :ok = TerminalEvents.on_cell_started(context)
    assert_receive {:setup_terminal_data, %{cell_id: ^cell_id, chunk: _chunk}}

    :ok = TerminalRuntime.append_chat_output(cell_id, "prior")
    assert ["prior"] = TerminalRuntime.read_chat_output(cell_id)

    assert :ok = TerminalEvents.on_cell_stopped(context)

    assert_receive {:setup_terminal_exit, %{cell_id: ^cell_id, exit_code: 0, signal: nil}}
    assert_receive {:chat_terminal_exit, %{cell_id: ^cell_id, exit_code: 0, signal: nil}}
    assert [] = TerminalRuntime.read_setup_output(cell_id)
    assert [] = TerminalRuntime.read_chat_output(cell_id)
  end
end

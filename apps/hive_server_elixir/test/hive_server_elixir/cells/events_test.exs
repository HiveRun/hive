defmodule HiveServerElixir.Cells.EventsTest do
  use HiveServerElixir.DataCase, async: true

  alias HiveServerElixir.Cells.Events

  test "publishes workspace cell status and removed events" do
    workspace_id = Ash.UUID.generate()
    cell_id = Ash.UUID.generate()

    assert :ok = Events.subscribe_workspace(workspace_id)
    assert :ok = Events.publish_cell_status(workspace_id, cell_id)

    assert_receive {:cell_status, %{workspace_id: ^workspace_id, cell_id: ^cell_id}}

    assert :ok = Events.publish_cell_removed(workspace_id, cell_id)

    assert_receive {:cell_removed, %{workspace_id: ^workspace_id, cell_id: ^cell_id}}
  end

  test "publishes cell timing events" do
    cell_id = Ash.UUID.generate()
    timing_id = Ash.UUID.generate()

    assert :ok = Events.subscribe_cell_timing(cell_id)
    assert :ok = Events.publish_cell_timing(cell_id, timing_id)

    assert_receive {:cell_timing, %{cell_id: ^cell_id, timing_id: ^timing_id}}
  end

  test "publishes setup terminal data and exit events" do
    cell_id = Ash.UUID.generate()

    assert :ok = Events.subscribe_setup_terminal(cell_id)
    assert :ok = Events.publish_setup_terminal_data(cell_id, "hello")

    assert_receive {:setup_terminal_data, %{cell_id: ^cell_id, chunk: "hello"}}

    assert :ok = Events.publish_setup_terminal_exit(cell_id, 0, nil)

    assert_receive {:setup_terminal_exit, %{cell_id: ^cell_id, exit_code: 0, signal: nil}}

    assert :ok = Events.publish_setup_terminal_error(cell_id, "boom")

    assert_receive {:setup_terminal_error, %{cell_id: ^cell_id, message: "boom"}}
  end

  test "publishes service terminal events" do
    cell_id = Ash.UUID.generate()
    service_id = Ash.UUID.generate()

    assert :ok = Events.subscribe_service_terminal(cell_id, service_id)
    assert :ok = Events.publish_service_terminal_data(cell_id, service_id, "svc")

    assert_receive {:service_terminal_data,
                    %{cell_id: ^cell_id, service_id: ^service_id, chunk: "svc"}}

    assert :ok = Events.publish_service_terminal_exit(cell_id, service_id, 0, nil)

    assert_receive {:service_terminal_exit,
                    %{cell_id: ^cell_id, service_id: ^service_id, exit_code: 0, signal: nil}}

    assert :ok = Events.publish_service_terminal_error(cell_id, service_id, "svc-boom")

    assert_receive {:service_terminal_error,
                    %{cell_id: ^cell_id, service_id: ^service_id, message: "svc-boom"}}
  end

  test "publishes chat terminal events" do
    cell_id = Ash.UUID.generate()

    assert :ok = Events.subscribe_chat_terminal(cell_id)
    assert :ok = Events.publish_chat_terminal_data(cell_id, "chat")

    assert_receive {:chat_terminal_data, %{cell_id: ^cell_id, chunk: "chat"}}

    assert :ok = Events.publish_chat_terminal_exit(cell_id, 0, nil)

    assert_receive {:chat_terminal_exit, %{cell_id: ^cell_id, exit_code: 0, signal: nil}}

    assert :ok = Events.publish_chat_terminal_error(cell_id, "chat-boom")

    assert_receive {:chat_terminal_error, %{cell_id: ^cell_id, message: "chat-boom"}}
  end
end

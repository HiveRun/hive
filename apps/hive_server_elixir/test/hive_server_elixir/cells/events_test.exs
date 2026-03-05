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
  end
end

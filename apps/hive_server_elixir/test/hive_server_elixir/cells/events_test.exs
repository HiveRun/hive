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
end

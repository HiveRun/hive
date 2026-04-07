defmodule HiveServerElixirWeb.CellsSerializerTest do
  use ExUnit.Case, async: true

  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Workspace
  alias HiveServerElixirWeb.CellsSerializer

  test "serialize_cell reuses cell transport payload with workspace fallback" do
    inserted_at = DateTime.utc_now() |> DateTime.truncate(:second)
    updated_at = DateTime.add(inserted_at, 5, :second)

    cell = %Cell{
      id: "cell-1",
      name: "Serializer Cell",
      workspace_id: "workspace-1",
      description: "serializer",
      template_id: "default-template",
      workspace_root_path: nil,
      workspace_path: "/tmp/cell-workspace",
      opencode_session_id: "session-1",
      status: :ready,
      last_setup_error: nil,
      branch_name: nil,
      base_commit: nil,
      inserted_at: inserted_at,
      updated_at: updated_at
    }

    payload =
      CellsSerializer.serialize_cell(cell,
        workspace: %Workspace{path: "/tmp/workspace"},
        include_setup_log: false
      )

    assert payload.id == "cell-1"
    assert payload.workspaceId == "workspace-1"
    assert payload.workspaceRootPath == "/tmp/workspace"
    assert payload.workspacePath == "/tmp/cell-workspace"
    assert payload.opencodeSessionId == "session-1"
    assert payload.opencodeCommand == "opencode \"/tmp/cell-workspace\" --session \"session-1\""

    assert payload.status == "ready"
    assert payload.createdAt == DateTime.to_iso8601(inserted_at)
    assert payload.updatedAt == DateTime.to_iso8601(updated_at)
  end
end

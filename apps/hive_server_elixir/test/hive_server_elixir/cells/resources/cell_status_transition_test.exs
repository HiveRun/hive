defmodule HiveServerElixir.Cells.Resources.CellStatusTransitionTest do
  use HiveServerElixir.DataCase, async: false

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Workspace

  test "begin_provisioning transitions an error cell and clears stale setup errors" do
    workspace = workspace!("cell-status-begin")
    cell = cell!(workspace, "error", "stale error")

    assert {:ok, updated_cell} = Ash.update(cell, %{}, action: :begin_provisioning, domain: Cells)
    assert updated_cell.status == :provisioning
    assert updated_cell.last_setup_error == nil
  end

  test "mark_ready transitions a provisioning cell and clears setup errors" do
    workspace = workspace!("cell-status-ready")
    cell = cell!(workspace, "provisioning", "old error")

    assert {:ok, updated_cell} = Ash.update(cell, %{}, action: :mark_ready, domain: Cells)
    assert updated_cell.status == :ready
    assert updated_cell.last_setup_error == nil
  end

  test "mark_error transitions a provisioning cell and preserves error details" do
    workspace = workspace!("cell-status-error")
    cell = cell!(workspace, "provisioning")

    assert {:ok, updated_cell} =
             Ash.update(
               cell,
               %{last_setup_error: "template runtime failed"},
               action: :mark_error,
               domain: Cells
             )

    assert updated_cell.status == :error
    assert updated_cell.last_setup_error == "template runtime failed"
  end

  test "mark_ready rejects invalid lifecycle transitions" do
    workspace = workspace!("cell-status-invalid")
    cell = cell!(workspace, "error", "still failed")

    assert {:error, error} = Ash.update(cell, %{}, action: :mark_ready, domain: Cells)

    assert inspect(Ash.Error.to_error_class(error)) =~
             "cannot transition cell status from error to ready"
  end

  test "generic update no longer allows arbitrary status changes" do
    workspace = workspace!("cell-status-generic")
    cell = cell!(workspace, "error")

    assert {:error, error} = Ash.update(cell, %{status: "ready"}, domain: Cells)
    assert inspect(Ash.Error.to_error_class(error)) =~ "status"
  end

  defp workspace!(suffix) do
    assert {:ok, workspace} =
             Ash.create(
               Workspace,
               %{path: "/tmp/workspace-#{suffix}", label: "Workspace #{suffix}"},
               domain: Cells
             )

    workspace
  end

  defp cell!(workspace, status, last_setup_error \\ nil) do
    assert {:ok, cell} =
             Ash.create(
               Cell,
               %{
                 workspace_id: workspace.id,
                 description: "Cell #{status}",
                 status: status,
                 last_setup_error: last_setup_error
               },
               domain: Cells
             )

    cell
  end
end

defmodule HiveServerElixir.Cells.Resources.ProvisioningAttemptTransitionTest do
  use HiveServerElixir.DataCase, async: false

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Provisioning
  alias HiveServerElixir.Cells.Workspace

  test "begin_attempt_record initializes the first attempt" do
    cell = cell!("provisioning-attempt-create")

    assert {:ok, provisioning} =
             Ash.create(
               Provisioning,
               %{cell_id: cell.id, start_mode: "build"},
               action: :begin_attempt_record,
               domain: Cells
             )

    assert provisioning.attempt_count == 1
    assert provisioning.start_mode == "build"
    assert %DateTime{} = provisioning.started_at
    assert provisioning.finished_at == nil
  end

  test "begin_attempt increments the attempt count and clears stale finished_at" do
    cell = cell!("provisioning-attempt-update")

    assert {:ok, provisioning} =
             Ash.create(
               Provisioning,
               %{cell_id: cell.id, attempt_count: 2},
               domain: Cells
             )

    assert {:ok, updated_provisioning} =
             Ash.update(provisioning, %{}, action: :begin_attempt, domain: Cells)

    assert updated_provisioning.attempt_count == 3
    assert %DateTime{} = updated_provisioning.started_at
    assert updated_provisioning.finished_at == nil
  end

  test "finish_attempt timestamps completion without changing attempt_count" do
    cell = cell!("provisioning-attempt-finish")

    assert {:ok, provisioning} =
             Ash.create(
               Provisioning,
               %{cell_id: cell.id, attempt_count: 4},
               domain: Cells
             )

    assert {:ok, updated_provisioning} =
             Ash.update(provisioning, %{}, action: :finish_attempt, domain: Cells)

    assert updated_provisioning.attempt_count == 4
    assert %DateTime{} = updated_provisioning.finished_at
  end

  defp cell!(suffix) do
    assert {:ok, workspace} =
             Ash.create(
               Workspace,
               %{path: "/tmp/workspace-#{suffix}", label: "Workspace #{suffix}"},
               domain: Cells
             )

    assert {:ok, cell} =
             Ash.create(
               Cell,
               %{workspace_id: workspace.id, description: "Cell #{suffix}", status: "ready"},
               domain: Cells
             )

    cell
  end
end

defmodule HiveServerElixir.Cells.ResourceSummaryTest do
  use HiveServerElixir.DataCase, async: false

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.ResourceSummary
  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.Workspace

  test "build reconciles stale running services before summarizing" do
    cell = cell!("resource-summary-reconcile")

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

    assert {:ok, running_service} =
             Ash.update(service, %{pid: 0}, action: :mark_running, domain: Cells)

    summary = ResourceSummary.build(cell)
    [process] = summary.processes

    assert process.status == "error"
    assert process.processAlive == false
    assert process.active == false

    assert {:ok, persisted_service} = Ash.get(Service, running_service.id, domain: Cells)
    assert persisted_service.status == :error
    assert persisted_service.last_known_error == "Process exited unexpectedly"
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

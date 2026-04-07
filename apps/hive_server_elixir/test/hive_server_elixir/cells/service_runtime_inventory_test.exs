defmodule HiveServerElixir.Cells.ServiceRuntimeInventoryTest do
  use HiveServerElixir.DataCase, async: false

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.Workspace

  test "reconcile_service_runtime_inventory updates stale service state" do
    service = service!("service-runtime-inventory")

    assert {:ok, running_service} =
             Ash.update(service, %{pid: 0}, action: :mark_running, domain: Cells)

    assert {:ok, %{reconciled_count: 1, updated_count: 1}} =
             Cells.reconcile_service_runtime_inventory()

    assert {:ok, refreshed_service} = Ash.get(Service, running_service.id, domain: Cells)
    assert refreshed_service.status == :error
    assert refreshed_service.pid == nil
    assert refreshed_service.last_known_error == "Process exited unexpectedly"
  end

  test "service resource defines a scheduled AshOban runtime reconciliation action" do
    assert schedule = AshOban.Info.oban_scheduled_action(Service, :reconcile_runtime_inventory)
    assert schedule.action == :reconcile_runtime_inventory
    assert schedule.cron == "*/1 * * * *"
  end

  defp service!(suffix) do
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

    service
  end
end

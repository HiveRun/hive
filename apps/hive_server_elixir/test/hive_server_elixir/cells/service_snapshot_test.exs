defmodule HiveServerElixir.Cells.ServiceSnapshotTest do
  use HiveServerElixir.DataCase, async: false

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.ServiceSnapshot
  alias HiveServerElixir.Cells.Workspace

  test "rpc_payload reconciles stale running services through the explicit action" do
    service = service!("service-snapshot-reconcile")

    assert {:ok, running_service} =
             Ash.update(service, %{pid: 0}, action: :mark_running, domain: Cells)

    payload = ServiceSnapshot.rpc_payload(running_service)

    assert payload.status == "error"
    assert payload.last_known_error == "Process exited unexpectedly"
    refute Map.has_key?(payload, :pid)

    assert {:ok, persisted_service} = Ash.get(Service, running_service.id, domain: Cells)
    assert persisted_service.status == :error
    assert persisted_service.last_known_error == "Process exited unexpectedly"
    assert persisted_service.pid == nil
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

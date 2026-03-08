defmodule HiveServerElixir.Cells.Resources.ServiceStatusTransitionTest do
  use HiveServerElixir.DataCase, async: false

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.Workspace

  test "services default to stopped and clear runtime fields on create" do
    service = service!("service-status-default")

    assert service.status == :stopped
    assert service.pid == nil
    assert service.last_known_error == nil
  end

  test "mark_running transitions a stopped service and clears stale errors" do
    service = service!("service-status-running")

    assert {:ok, updated_service} =
             Ash.update(
               service,
               %{pid: 12_345},
               action: :mark_running,
               domain: Cells
             )

    assert updated_service.status == :running
    assert updated_service.pid == 12_345
    assert updated_service.last_known_error == nil
  end

  test "mark_error transitions a running service and clears the pid" do
    service = service!("service-status-error")

    assert {:ok, running_service} =
             Ash.update(service, %{pid: 77}, action: :mark_running, domain: Cells)

    assert {:ok, updated_service} =
             Ash.update(
               running_service,
               %{last_known_error: "boom"},
               action: :mark_error,
               domain: Cells
             )

    assert updated_service.status == :error
    assert updated_service.pid == nil
    assert updated_service.last_known_error == "boom"
  end

  test "mark_stopped transitions a running service and clears runtime details" do
    service = service!("service-status-stopped")

    assert {:ok, running_service} =
             Ash.update(service, %{pid: 88}, action: :mark_running, domain: Cells)

    assert {:ok, updated_service} =
             Ash.update(running_service, %{}, action: :mark_stopped, domain: Cells)

    assert updated_service.status == :stopped
    assert updated_service.pid == nil
    assert updated_service.last_known_error == nil
  end

  test "service lifecycle writes require explicit actions" do
    service = service!("service-status-generic")

    assert_raise RuntimeError, ~r/Required primary update action/, fn ->
      Ash.update(service, %{status: "running"}, domain: Cells)
    end
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

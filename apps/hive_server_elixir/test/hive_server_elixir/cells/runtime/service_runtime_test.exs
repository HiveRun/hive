defmodule HiveServerElixir.Cells.ServiceRuntimeTest do
  use HiveServerElixir.DataCase, async: false

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Events
  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.ServiceRuntime
  alias HiveServerElixir.Cells.Workspace
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Repo

  setup do
    Ecto.Adapters.SQL.Sandbox.allow(Repo, self(), Process.whereis(ServiceRuntime))
    :ok
  end

  test "ensure_service_running streams real process output and exit" do
    workspace = workspace!("service-runtime-output")
    cell = cell!(workspace.id, "service runtime cell", "ready")

    assert {:ok, service} =
             Ash.create(
               Service,
               %{
                 cell_id: cell.id,
                 name: "echo",
                 type: "process",
                 command: "printf 'hello from service\\n'",
                 cwd: "/tmp",
                 env: %{},
                 definition: %{}
               },
               domain: Cells
             )

    assert :ok = Events.subscribe_service_terminal(cell.id, service.id)
    assert :ok = Events.subscribe_cell_services(cell.id)
    assert :ok = ServiceRuntime.ensure_service_running(service)

    assert_receive {:service_update, %{cell_id: start_cell_id, service_id: start_service_id}},
                   1_000

    assert start_cell_id == cell.id
    assert start_service_id == service.id

    assert_receive {:service_terminal_data,
                    %{cell_id: cell_id, service_id: service_id, chunk: chunk}},
                   1_000

    assert cell_id == cell.id
    assert service_id == service.id
    assert chunk =~ "hello from service"

    assert_receive {:service_terminal_exit,
                    %{cell_id: ^cell_id, service_id: ^service_id, exit_code: exit_code}},
                   1_000

    assert is_integer(exit_code)

    assert_receive {:service_update, %{cell_id: ^cell_id, service_id: ^service_id}}, 1_000

    assert {:ok, stopped_service} = Ash.get(Service, service.id, domain: Cells)
    assert stopped_service.status == :stopped
    assert is_nil(stopped_service.pid)

    assert :ok = ServiceRuntime.stop_cell_services(cell.id)
  end

  test "write_input reports missing services and accepts running services" do
    assert {:error, :not_running} = ServiceRuntime.write_input("missing-service", "roundtrip\n")

    workspace = workspace!("service-runtime-input")
    cell = cell!(workspace.id, "service runtime cell", "ready")

    assert {:ok, service} =
             Ash.create(
               Service,
               %{
                 cell_id: cell.id,
                 name: "sleep",
                 type: "process",
                 command: "sleep 5",
                 cwd: "/tmp",
                 env: %{},
                 definition: %{}
               },
               domain: Cells
             )

    assert :ok = Events.subscribe_service_terminal(cell.id, service.id)
    assert :ok = ServiceRuntime.ensure_service_running(service)
    assert :ok = ServiceRuntime.write_input(service.id, "roundtrip\\n")

    assert {:ok, running_service} = Ash.get(Service, service.id, domain: Cells)
    assert running_service.status == :running
    assert is_integer(running_service.pid)

    assert :ok = ServiceRuntime.stop_cell_services(cell.id)

    assert {:ok, stopped_service} = Ash.get(Service, service.id, domain: Cells)
    assert stopped_service.status == :stopped
    assert is_nil(stopped_service.pid)
  end

  defp workspace!(suffix) do
    assert {:ok, workspace} =
             Ash.create(
               Workspace,
               %{path: "/tmp/ws-#{suffix}", label: "Workspace #{suffix}"},
               domain: Cells
             )

    workspace
  end

  defp cell!(workspace_id, description, status) do
    assert {:ok, cell} =
             Ash.create(
               Cell,
               %{workspace_id: workspace_id, description: description, status: status},
               domain: Cells
             )

    cell
  end
end

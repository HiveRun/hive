defmodule HiveServerElixir.Cells.ServiceReconciliation do
  @moduledoc false

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.ServiceRuntime
  alias HiveServerElixir.Cells.ServiceStatus

  @type snapshot :: %{
          service: Service.t(),
          status: atom() | String.t() | nil,
          last_known_error: String.t() | nil,
          pid: integer() | nil,
          process_alive: boolean()
        }

  @spec reconcile(Service.t()) :: snapshot()
  def reconcile(%Service{} = service) do
    runtime_status = ServiceRuntime.runtime_status(service.id)

    process_alive =
      case runtime_status do
        %{status: "running"} -> true
        _other -> os_pid_alive?(service.pid)
      end

    {status, last_known_error} =
      ServiceStatus.derive(service.status, service.last_known_error, process_alive)

    pid =
      case runtime_status do
        %{status: "running", pid: runtime_pid} when is_integer(runtime_pid) -> runtime_pid
        _other when process_alive -> service.pid
        _other -> nil
      end

    %{
      service: maybe_persist(service, status, last_known_error, pid),
      status: status,
      last_known_error: last_known_error,
      pid: pid,
      process_alive: process_alive
    }
  end

  @spec reconcile_all([Service.t()]) :: [snapshot()]
  def reconcile_all(services) when is_list(services) do
    Enum.map(services, &reconcile/1)
  end

  defp maybe_persist(%Service{} = service, status, last_known_error, pid) do
    should_persist =
      status != service.status ||
        last_known_error != service.last_known_error ||
        pid != service.pid

    if should_persist do
      case Ash.update(
             service,
             %{
               status: ServiceStatus.present(status),
               last_known_error: last_known_error,
               pid: pid
             },
             action: :reconcile_runtime_state,
             domain: Cells
           ) do
        {:ok, updated} ->
          updated

        {:error, _error} ->
          %{service | status: status, last_known_error: last_known_error, pid: pid}
      end
    else
      service
    end
  end

  defp os_pid_alive?(pid) when is_integer(pid) and pid > 0 do
    case System.cmd("kill", ["-0", Integer.to_string(pid)], stderr_to_stdout: true) do
      {_output, 0} -> true
      {_output, _status} -> false
    end
  rescue
    _error ->
      false
  end

  defp os_pid_alive?(_pid), do: false
end

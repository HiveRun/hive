defmodule HiveServerElixir.Cells.ServiceRuntime do
  @moduledoc false

  use GenServer

  alias HiveServerElixir.Cells.Events
  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.TerminalRuntime

  @service_call_timeout_ms 120_000

  @type state :: %{
          services: %{String.t() => %{cell_id: String.t(), service: Service.t()}}
        }

  def start_link(opts) do
    GenServer.start_link(__MODULE__, :ok, opts)
  end

  @spec ensure_service_running(Service.t()) :: :ok | {:error, term()}
  def ensure_service_running(%Service{} = service) do
    GenServer.call(__MODULE__, {:start_service, service}, @service_call_timeout_ms)
  end

  @spec start_service(Service.t()) :: :ok | {:error, term()}
  def start_service(%Service{} = service) do
    GenServer.call(__MODULE__, {:start_service, service}, @service_call_timeout_ms)
  end

  @spec stop_service(Service.t()) :: :ok | {:error, term()}
  def stop_service(%Service{} = service) do
    GenServer.call(__MODULE__, {:stop_service, service}, @service_call_timeout_ms)
  end

  @spec restart_service(Service.t()) :: :ok | {:error, term()}
  def restart_service(%Service{} = service) do
    GenServer.call(__MODULE__, {:restart_service, service}, @service_call_timeout_ms)
  end

  @spec write_input(String.t(), String.t()) :: :ok | {:error, :not_running}
  def write_input(service_id, chunk) when is_binary(service_id) and is_binary(chunk) do
    GenServer.call(__MODULE__, {:write_input, service_id, chunk})
  end

  @spec stop_cell_services(String.t()) :: :ok
  def stop_cell_services(cell_id) when is_binary(cell_id) do
    GenServer.call(__MODULE__, {:stop_cell_services, cell_id}, @service_call_timeout_ms)
  end

  @spec runtime_status(String.t()) :: %{status: String.t(), pid: integer() | nil} | nil
  def runtime_status(service_id) when is_binary(service_id) do
    GenServer.call(__MODULE__, {:runtime_status, service_id})
  end

  @spec notify_terminal_exit(String.t(), String.t(), integer() | nil) :: :ok
  def notify_terminal_exit(cell_id, service_id, exit_code) do
    GenServer.cast(__MODULE__, {:terminal_exit, cell_id, service_id, exit_code})
  end

  @impl true
  def init(:ok) do
    {:ok, %{services: %{}}}
  end

  @impl true
  def handle_call({:start_service, %Service{} = service}, _from, state) do
    case start_service_internal(state, service) do
      {:ok, next_state} -> {:reply, :ok, next_state}
      {:error, reason, next_state} -> {:reply, {:error, reason}, next_state}
    end
  end

  def handle_call({:stop_service, %Service{} = service}, _from, state) do
    case stop_service_internal(state, service) do
      {:ok, next_state} -> {:reply, :ok, next_state}
      {:error, reason, next_state} -> {:reply, {:error, reason}, next_state}
    end
  end

  def handle_call({:restart_service, %Service{} = service}, _from, state) do
    with {:ok, stopped_state} <- stop_service_internal(state, service),
         {:ok, reloaded_service} <- reload_service(service.id),
         {:ok, started_state} <- start_service_internal(stopped_state, reloaded_service) do
      {:reply, :ok, started_state}
    else
      {:error, reason, next_state} -> {:reply, {:error, reason}, next_state}
      {:error, reason} -> {:reply, {:error, reason}, state}
    end
  end

  def handle_call({:write_input, service_id, chunk}, _from, state) do
    case Map.get(state.services, service_id) do
      %{cell_id: cell_id} ->
        result = TerminalRuntime.write_service_input(cell_id, service_id, chunk)
        {:reply, result, state}

      nil ->
        {:reply, {:error, :not_running}, state}
    end
  end

  def handle_call({:stop_cell_services, cell_id}, _from, state) do
    next_state =
      state.services
      |> Enum.filter(fn {_service_id, entry} -> entry.cell_id == cell_id end)
      |> Enum.reduce(state, fn {_service_id, %{service: service}}, acc ->
        case stop_service_internal(acc, service) do
          {:ok, updated} -> updated
          {:error, _reason, updated} -> updated
        end
      end)

    {:reply, :ok, next_state}
  end

  def handle_call({:runtime_status, service_id}, _from, state) do
    runtime =
      case Map.get(state.services, service_id) do
        %{cell_id: cell_id} -> TerminalRuntime.runtime_status({:service, cell_id, service_id})
        nil -> nil
      end

    {:reply, runtime, state}
  end

  @impl true
  def handle_cast({:terminal_exit, cell_id, service_id, exit_code}, state) do
    case Map.pop(state.services, service_id) do
      {nil, _services} ->
        {:noreply, state}

      {%{service: service}, services} ->
        last_known_error =
          if exit_code not in [0, nil], do: "Service exited with code #{exit_code}", else: nil

        _ =
          safe_persist_service_state(service, %{
            status: exit_status_to_state(exit_code),
            pid: nil,
            last_known_error: last_known_error
          })

        :ok = Events.publish_service_update(cell_id, service_id)
        {:noreply, %{state | services: services}}
    end
  end

  def handle_cast(_message, state), do: {:noreply, state}

  defp put_service(state, %Service{} = service) do
    services = Map.put(state.services, service.id, %{cell_id: service.cell_id, service: service})
    %{state | services: services}
  end

  defp start_service_internal(state, %Service{} = service) do
    case Map.fetch(state.services, service.id) do
      {:ok, _running} ->
        {:ok, state}

      :error ->
        case TerminalRuntime.ensure_service_session(service) do
          {:ok, session} ->
            case safe_persist_service_state(service, %{
                   status: "running",
                   pid: session.pid,
                   last_known_error: nil
                 }) do
              {:ok, persisted_service} ->
                :ok = Events.publish_service_update(service.cell_id, service.id)
                {:ok, put_service(state, persisted_service)}

              {:error, reason} ->
                _ =
                  TerminalRuntime.close_scope({:service, service.cell_id, service.id},
                    publish_terminal_exit?: false,
                    notify_service_runtime?: false,
                    close_terminal_session?: true
                  )

                :ok = Events.publish_service_update(service.cell_id, service.id)

                :ok =
                  Events.publish_service_terminal_error(
                    service.cell_id,
                    service.id,
                    inspect(reason)
                  )

                {:error, reason, state}
            end

          {:error, reason} ->
            _ =
              safe_persist_service_state(service, %{
                status: "error",
                pid: nil,
                last_known_error: inspect(reason)
              })

            :ok = Events.publish_service_update(service.cell_id, service.id)

            :ok =
              Events.publish_service_terminal_error(service.cell_id, service.id, inspect(reason))

            {:error, reason, state}
        end
    end
  end

  defp stop_service_internal(state, %Service{} = service) do
    case Map.pop(state.services, service.id) do
      {nil, _services} ->
        case safe_persist_service_state(service, %{
               status: "stopped",
               pid: nil,
               last_known_error: nil
             }) do
          {:ok, _updated} ->
            :ok = Events.publish_service_update(service.cell_id, service.id)
            {:ok, state}

          {:error, reason} ->
            {:error, reason, state}
        end

      {%{service: persisted_service}, services} ->
        _ =
          TerminalRuntime.close_scope({:service, service.cell_id, service.id},
            publish_terminal_exit?: false,
            notify_service_runtime?: false,
            close_terminal_session?: true
          )

        next_state = %{state | services: services}

        case safe_persist_service_state(persisted_service, %{
               status: "stopped",
               pid: nil,
               last_known_error: nil
             }) do
          {:ok, _updated} ->
            :ok = Events.publish_service_update(service.cell_id, service.id)
            :ok = Events.publish_service_terminal_exit(service.cell_id, service.id, 0, nil)
            {:ok, next_state}

          {:error, reason} ->
            {:error, reason, next_state}
        end
    end
  end

  defp persist_service_state(%Service{} = service, attrs) when is_map(attrs) do
    case Map.get(attrs, :status) do
      "running" ->
        Ash.update(service, Map.take(attrs, [:pid, :port]), action: :mark_running)

      :running ->
        Ash.update(service, Map.take(attrs, [:pid, :port]), action: :mark_running)

      "stopped" ->
        Ash.update(service, Map.take(attrs, [:port]), action: :mark_stopped)

      :stopped ->
        Ash.update(service, Map.take(attrs, [:port]), action: :mark_stopped)

      "error" ->
        Ash.update(service, Map.take(attrs, [:last_known_error, :port]), action: :mark_error)

      :error ->
        Ash.update(service, Map.take(attrs, [:last_known_error, :port]), action: :mark_error)

      _other ->
        {:error, :invalid_status_transition}
    end
  end

  defp safe_persist_service_state(%Service{} = service, attrs) when is_map(attrs) do
    persist_service_state(service, attrs)
  rescue
    _error -> {:error, :persist_failed}
  end

  defp exit_status_to_state(0), do: "stopped"
  defp exit_status_to_state(nil), do: "stopped"
  defp exit_status_to_state(_status), do: "error"

  defp reload_service(service_id) when is_binary(service_id) do
    Ash.get(Service, service_id)
  end
end

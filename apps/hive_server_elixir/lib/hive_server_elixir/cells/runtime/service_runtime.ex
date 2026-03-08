defmodule HiveServerElixir.Cells.ServiceRuntime do
  @moduledoc false

  use GenServer

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Events
  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.TerminalRuntime

  @shell System.find_executable("sh") || "/bin/sh"

  @type state :: %{
          services: %{String.t() => %{cell_id: String.t(), port: port(), service: Service.t()}},
          ports: %{port() => String.t()}
        }

  def start_link(opts) do
    GenServer.start_link(__MODULE__, :ok, opts)
  end

  @spec ensure_service_running(Service.t()) :: :ok | {:error, term()}
  def ensure_service_running(%Service{} = service) do
    GenServer.call(__MODULE__, {:start_service, service})
  end

  @spec start_service(Service.t()) :: :ok | {:error, term()}
  def start_service(%Service{} = service) do
    GenServer.call(__MODULE__, {:start_service, service})
  end

  @spec stop_service(Service.t()) :: :ok | {:error, term()}
  def stop_service(%Service{} = service) do
    GenServer.call(__MODULE__, {:stop_service, service})
  end

  @spec restart_service(Service.t()) :: :ok | {:error, term()}
  def restart_service(%Service{} = service) do
    GenServer.call(__MODULE__, {:restart_service, service})
  end

  @spec write_input(String.t(), String.t()) :: :ok | {:error, :not_running}
  def write_input(service_id, chunk) when is_binary(service_id) and is_binary(chunk) do
    GenServer.call(__MODULE__, {:write_input, service_id, chunk})
  end

  @spec stop_cell_services(String.t()) :: :ok
  def stop_cell_services(cell_id) when is_binary(cell_id) do
    GenServer.call(__MODULE__, {:stop_cell_services, cell_id})
  end

  @spec runtime_status(String.t()) :: %{status: String.t(), pid: integer() | nil} | nil
  def runtime_status(service_id) when is_binary(service_id) do
    GenServer.call(__MODULE__, {:runtime_status, service_id})
  end

  @impl true
  def init(:ok) do
    {:ok, %{services: %{}, ports: %{}}}
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
      {:error, reason, next_state} ->
        {:reply, {:error, reason}, next_state}

      {:error, reason} ->
        {:reply, {:error, reason}, state}
    end
  end

  def handle_call({:write_input, service_id, chunk}, _from, state) do
    case Map.get(state.services, service_id) do
      %{port: port} ->
        result = Port.command(port, chunk)

        if result == true do
          {:reply, :ok, state}
        else
          {:reply, {:error, :not_running}, state}
        end

      nil ->
        {:reply, {:error, :not_running}, state}
    end
  end

  def handle_call({:stop_cell_services, cell_id}, _from, state) do
    service_ids =
      state.services
      |> Enum.filter(fn {_service_id, entry} -> entry.cell_id == cell_id end)
      |> Enum.map(fn {service_id, _entry} -> service_id end)

    next_state =
      Enum.reduce(service_ids, state, fn service_id, acc ->
        case Map.get(acc.services, service_id) do
          nil ->
            acc

          %{service: service} ->
            case stop_service_internal(acc, service) do
              {:ok, updated} -> updated
              {:error, _reason, updated} -> updated
            end
        end
      end)

    {:reply, :ok, next_state}
  end

  def handle_call({:runtime_status, service_id}, _from, state) do
    runtime =
      case Map.get(state.services, service_id) do
        %{port: port} when is_port(port) ->
          pid =
            case Port.info(port, :os_pid) do
              {:os_pid, os_pid} when is_integer(os_pid) -> os_pid
              _other -> nil
            end

          %{status: "running", pid: pid}

        _other ->
          nil
      end

    {:reply, runtime, state}
  end

  @impl true
  def handle_info({port, {:data, {:eol, line}}}, state) when is_port(port) do
    {:noreply, publish_service_data(state, port, line <> "\n")}
  end

  def handle_info({port, {:data, {:noeol, line}}}, state) when is_port(port) do
    {:noreply, publish_service_data(state, port, line)}
  end

  def handle_info({port, {:data, chunk}}, state) when is_port(port) and is_binary(chunk) do
    {:noreply, publish_service_data(state, port, chunk)}
  end

  def handle_info({port, {:exit_status, status}}, state) when is_port(port) do
    case pop_service_by_port(state, port) do
      {{:ok, service_id, entry}, next_state} ->
        last_known_error = if(status != 0, do: "Service exited with code #{status}", else: nil)

        _ =
          safe_persist_service_state(entry.service, %{
            status: exit_status_to_state(status),
            pid: nil,
            last_known_error: last_known_error
          })

        :ok = Events.publish_service_update(entry.cell_id, service_id)
        :ok = Events.publish_service_terminal_exit(entry.cell_id, service_id, status, nil)
        {:noreply, next_state}

      {:error, next_state} ->
        {:noreply, next_state}
    end
  end

  def handle_info(_message, state), do: {:noreply, state}

  defp start_service_port(%Service{} = service) do
    opts = [
      :binary,
      :exit_status,
      :stderr_to_stdout,
      :use_stdio,
      :hide,
      {:line, 8_192},
      args: ["-lc", service.command],
      cd: valid_cwd(service.cwd),
      env: env_to_charlist(service.env)
    ]

    {:ok, Port.open({:spawn_executable, @shell}, opts)}
  rescue
    error ->
      {:error, error}
  end

  defp valid_cwd(cwd) when is_binary(cwd) do
    if File.dir?(cwd), do: cwd, else: File.cwd!()
  end

  defp valid_cwd(_cwd), do: File.cwd!()

  defp env_to_charlist(env) when is_map(env) do
    Enum.map(env, fn {key, value} ->
      {to_charlist(to_string(key)), to_charlist(to_string(value))}
    end)
  end

  defp env_to_charlist(_env), do: []

  defp put_service(state, %Service{} = service, port) do
    services =
      Map.put(state.services, service.id, %{
        cell_id: service.cell_id,
        port: port,
        service: service
      })

    ports = Map.put(state.ports, port, service.id)
    %{state | services: services, ports: ports}
  end

  defp start_service_internal(state, %Service{} = service) do
    case Map.fetch(state.services, service.id) do
      {:ok, _running} ->
        {:ok, state}

      :error ->
        case start_service_port(service) do
          {:ok, port} ->
            os_pid =
              case Port.info(port, :os_pid) do
                {:os_pid, pid} when is_integer(pid) -> pid
                _other -> nil
              end

            case safe_persist_service_state(service, %{
                   status: "running",
                   pid: os_pid,
                   last_known_error: nil
                 }) do
              {:ok, persisted_service} ->
                _ = TerminalRuntime.ensure_service_session(service.cell_id, service.id)
                :ok = Events.publish_service_update(service.cell_id, service.id)
                {:ok, put_service(state, persisted_service, port)}

              {:error, reason} ->
                _ = safe_port_close(port)
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

      {%{port: port} = entry, services} ->
        _ = safe_port_close(port)

        next_state = %{state | services: services, ports: Map.delete(state.ports, port)}

        case safe_persist_service_state(entry.service, %{
               status: "stopped",
               pid: nil,
               last_known_error: nil
             }) do
          {:ok, _updated} ->
            :ok = Events.publish_service_update(entry.cell_id, service.id)
            :ok = Events.publish_service_terminal_exit(entry.cell_id, service.id, 0, nil)
            {:ok, next_state}

          {:error, reason} ->
            {:error, reason, next_state}
        end
    end
  end

  defp publish_service_data(state, port, chunk) do
    case Map.get(state.ports, port) do
      nil ->
        state

      service_id ->
        %{cell_id: cell_id} = Map.fetch!(state.services, service_id)
        :ok = TerminalRuntime.append_service_output(cell_id, service_id, chunk)
        :ok = Events.publish_service_terminal_data(cell_id, service_id, chunk)
        state
    end
  end

  defp pop_service_by_port(state, port) do
    case Map.pop(state.ports, port) do
      {nil, _ports} ->
        {:error, state}

      {service_id, ports} ->
        case Map.pop(state.services, service_id) do
          {nil, services} ->
            {:error, %{state | services: services, ports: ports}}

          {entry, services} ->
            {{:ok, service_id, entry}, %{state | services: services, ports: ports}}
        end
    end
  end

  defp safe_port_close(port) when is_port(port) do
    Port.close(port)
  rescue
    _error ->
      :ok
  end

  defp persist_service_state(%Service{} = service, attrs) when is_map(attrs) do
    case Map.get(attrs, :status) do
      "running" ->
        Ash.update(service, Map.take(attrs, [:pid, :port]), action: :mark_running, domain: Cells)

      :running ->
        Ash.update(service, Map.take(attrs, [:pid, :port]), action: :mark_running, domain: Cells)

      "stopped" ->
        Ash.update(service, Map.take(attrs, [:port]), action: :mark_stopped, domain: Cells)

      :stopped ->
        Ash.update(service, Map.take(attrs, [:port]), action: :mark_stopped, domain: Cells)

      "error" ->
        Ash.update(
          service,
          Map.take(attrs, [:last_known_error, :port]),
          action: :mark_error,
          domain: Cells
        )

      :error ->
        Ash.update(
          service,
          Map.take(attrs, [:last_known_error, :port]),
          action: :mark_error,
          domain: Cells
        )

      _other ->
        {:error, :invalid_status_transition}
    end
  end

  defp safe_persist_service_state(%Service{} = service, attrs) when is_map(attrs) do
    persist_service_state(service, attrs)
  rescue
    _error ->
      {:error, :persist_failed}
  end

  defp exit_status_to_state(0), do: "stopped"
  defp exit_status_to_state(_status), do: "error"

  defp reload_service(service_id) when is_binary(service_id) do
    Ash.get(Service, service_id, domain: Cells)
  end
end

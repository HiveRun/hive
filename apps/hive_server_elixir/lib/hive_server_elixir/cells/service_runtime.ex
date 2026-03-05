defmodule HiveServerElixir.Cells.ServiceRuntime do
  @moduledoc false

  use GenServer

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
    GenServer.call(__MODULE__, {:ensure_service_running, service})
  end

  @spec write_input(String.t(), String.t()) :: :ok | {:error, :not_running}
  def write_input(service_id, chunk) when is_binary(service_id) and is_binary(chunk) do
    GenServer.call(__MODULE__, {:write_input, service_id, chunk})
  end

  @spec stop_cell_services(String.t()) :: :ok
  def stop_cell_services(cell_id) when is_binary(cell_id) do
    GenServer.call(__MODULE__, {:stop_cell_services, cell_id})
  end

  @impl true
  def init(:ok) do
    {:ok, %{services: %{}, ports: %{}}}
  end

  @impl true
  def handle_call({:ensure_service_running, %Service{} = service}, _from, state) do
    case Map.fetch(state.services, service.id) do
      {:ok, _running} ->
        {:reply, :ok, state}

      :error ->
        case start_service_port(service) do
          {:ok, port} ->
            _ = TerminalRuntime.ensure_service_session(service.cell_id, service.id)

            next_state =
              state
              |> put_service(service, port)

            {:reply, :ok, next_state}

          {:error, reason} ->
            :ok =
              Events.publish_service_terminal_error(service.cell_id, service.id, inspect(reason))

            {:reply, {:error, reason}, state}
        end
    end
  end

  def handle_call({:write_input, service_id, chunk}, _from, state) do
    case Map.get(state.services, service_id) do
      %{port: port} ->
        true = Port.command(port, chunk)
        {:reply, :ok, state}

      nil ->
        {:reply, {:error, :not_running}, state}
    end
  end

  def handle_call({:stop_cell_services, cell_id}, _from, state) do
    service_ids =
      state.services
      |> Enum.filter(fn {_service_id, entry} -> entry.cell_id == cell_id end)
      |> Enum.map(fn {service_id, _entry} -> service_id end)

    next_state = Enum.reduce(service_ids, state, &stop_service(&1, &2))
    {:reply, :ok, next_state}
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

  defp stop_service(service_id, state) do
    case Map.pop(state.services, service_id) do
      {nil, _services} ->
        state

      {%{port: port}, services} ->
        _ = safe_port_close(port)
        ports = Map.delete(state.ports, port)
        %{state | services: services, ports: ports}
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
end

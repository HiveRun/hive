defmodule HiveServerElixir.Opencode.ServerManager do
  @moduledoc false

  use GenServer

  require Logger

  @default_config %{config: %{plugin: []}, host: "127.0.0.1", port: 0, timeout_ms: 20_000}

  @type state :: %{
          mode: :managed | :external,
          base_url: String.t(),
          server: map() | nil
        }

  @spec child_spec(keyword()) :: Supervisor.child_spec()
  def child_spec(opts) do
    %{
      id: Keyword.get(opts, :name, __MODULE__),
      start: {__MODULE__, :start_link, [opts]}
    }
  end

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts \\ []) do
    name = Keyword.get(opts, :name, __MODULE__)
    GenServer.start_link(__MODULE__, opts, name: name)
  end

  @spec base_url(GenServer.server()) :: String.t()
  def base_url(server \\ __MODULE__) do
    GenServer.call(server, :base_url)
  end

  @spec resolved_base_url() :: String.t()
  def resolved_base_url do
    System.get_env("HIVE_OPENCODE_BASE_URL") ||
      Application.get_env(:hive_server_elixir, :opencode_base_url) ||
      if is_pid(Process.whereis(__MODULE__)) do
        base_url()
      else
        "http://localhost:4096"
      end
  end

  @spec status(GenServer.server()) :: %{mode: :managed | :external, base_url: String.t()}
  def status(server \\ __MODULE__) do
    GenServer.call(server, :status)
  end

  @impl true
  def init(opts) do
    Process.flag(:trap_exit, true)

    case resolve_external_base_url(opts) do
      base_url when is_binary(base_url) and base_url != "" ->
        Logger.info("OpenCode server mode=external base_url=#{base_url}")
        {:ok, %{mode: :external, base_url: base_url, server: nil}}

      _nil ->
        start_managed_server(opts)
    end
  end

  @impl true
  def handle_call(:base_url, _from, state) do
    {:reply, state.base_url, state}
  end

  @impl true
  def handle_call(:status, _from, state) do
    {:reply, Map.take(state, [:mode, :base_url]), state}
  end

  @impl true
  def handle_info({port, {:data, data}}, %{mode: :managed, server: %{port: port}} = state) do
    message = String.trim(data)

    if message != "" do
      Logger.debug("OpenCode server: #{message}")
    end

    {:noreply, state}
  end

  def handle_info(
        {port, {:exit_status, status}},
        %{mode: :managed, server: %{port: port}} = state
      ) do
    Logger.warning("OpenCode managed server exited with status=#{status}")
    {:stop, {:opencode_server_exited, status}, state}
  end

  def handle_info(_message, state), do: {:noreply, state}

  @impl true
  def terminate(_reason, %{mode: :managed, server: server}) when not is_nil(server) do
    _ = stop_managed_server(server)
    :ok
  end

  def terminate(_reason, _state), do: :ok

  defp start_managed_server(opts) do
    host = resolve_host(opts)
    port = resolve_port(opts)
    timeout_ms = resolve_timeout_ms(opts)
    config = resolve_server_config(opts)
    base_url = "http://#{host}:#{port}"

    case Keyword.get(opts, :create_server_fun) do
      start_fun when is_function(start_fun, 1) ->
        case start_fun.(%{hostname: host, port: port, timeout: timeout_ms, config: config}) do
          {:ok, server} ->
            {:ok, %{mode: :managed, base_url: Map.get(server, :url, base_url), server: server}}

          {:error, reason} ->
            {:stop, {:opencode_server_start_failed, reason}}
        end

      _other ->
        do_start_managed_server(base_url, host, port, timeout_ms, config)
    end
  end

  defp do_start_managed_server(base_url, host, port, timeout_ms, config) do
    config_root =
      Path.join(
        System.tmp_dir!(),
        "hive-opencode-config-#{port}-#{System.unique_integer([:positive])}"
      )

    with :ok <- write_server_config(config_root, config),
         {:ok, server} <- spawn_server_process(config_root, host, port),
         :ok <- await_server_ready(base_url, timeout_ms) do
      Logger.info("OpenCode server mode=managed base_url=#{base_url}")

      {:ok,
       %{mode: :managed, base_url: base_url, server: Map.put(server, :config_root, config_root)}}
    else
      {:error, reason} ->
        {:stop, {:opencode_server_start_failed, reason}}
    end
  end

  defp spawn_server_process(config_root, host, port) do
    executable = resolve_opencode_executable()

    env = [
      {~c"XDG_CONFIG_HOME", String.to_charlist(config_root)}
    ]

    port_ref =
      Port.open({:spawn_executable, executable}, [
        :binary,
        :exit_status,
        :stderr_to_stdout,
        :use_stdio,
        :hide,
        args: ["serve", "--port", Integer.to_string(port), "--hostname", host, "--print-logs"],
        env: env,
        cd: File.cwd!()
      ])

    os_pid =
      case Port.info(port_ref, :os_pid) do
        {:os_pid, pid} when is_integer(pid) -> pid
        _other -> nil
      end

    {:ok, %{port: port_ref, os_pid: os_pid}}
  rescue
    error -> {:error, error}
  end

  defp stop_managed_server(%{port: port_ref, os_pid: os_pid, config_root: config_root}) do
    _ = safe_port_close(port_ref)
    _ = terminate_pid(os_pid)
    _ = File.rm_rf(config_root)
    :ok
  end

  defp write_server_config(config_root, config) when is_map(config) do
    config_dir = Path.join(config_root, "opencode")
    config_path = Path.join(config_dir, "opencode.json")

    with :ok <- File.mkdir_p(config_dir),
         :ok <- File.write(config_path, Jason.encode_to_iodata!(config, pretty: true)) do
      :ok
    end
  end

  defp await_server_ready(base_url, timeout_ms) do
    deadline = System.monotonic_time(:millisecond) + timeout_ms
    do_await_server_ready(base_url, deadline)
  end

  defp do_await_server_ready(base_url, deadline) do
    case Req.get(base_url <> "/health") do
      {:ok, %{status: 200}} ->
        :ok

      _other ->
        if System.monotonic_time(:millisecond) >= deadline do
          {:error, :timeout}
        else
          Process.sleep(100)
          do_await_server_ready(base_url, deadline)
        end
    end
  end

  defp resolve_opencode_executable do
    configured = System.get_env("HIVE_OPENCODE_BIN")

    cond do
      is_binary(configured) and configured != "" and File.exists?(configured) ->
        configured

      is_binary(configured) and configured != "" and is_binary(System.find_executable(configured)) ->
        System.find_executable(configured)

      is_binary(System.find_executable("opencode")) ->
        System.find_executable("opencode")

      true ->
        raise "Unable to locate opencode executable"
    end
  end

  defp resolve_external_base_url(opts) do
    Keyword.get(opts, :external_base_url) ||
      System.get_env("HIVE_OPENCODE_BASE_URL") ||
      Application.get_env(:hive_server_elixir, :opencode_base_url)
  end

  defp resolve_manager_config do
    configured =
      :hive_server_elixir
      |> Application.get_env(:opencode_server_manager, [])
      |> Enum.into(%{})

    @default_config
    |> Map.merge(configured)
  end

  defp resolve_host(opts) do
    Keyword.get(opts, :host, resolve_manager_config().host)
  end

  defp resolve_port(opts) do
    case Keyword.get(opts, :port, resolve_manager_config().port) do
      0 -> reserve_port()
      port -> port
    end
  end

  defp resolve_timeout_ms(opts) do
    Keyword.get(opts, :timeout_ms, env_timeout_ms() || resolve_manager_config().timeout_ms)
  end

  defp resolve_server_config(opts) do
    Keyword.get(opts, :config, resolve_manager_config().config)
  end

  defp env_timeout_ms do
    case System.get_env("HIVE_OPENCODE_START_TIMEOUT_MS") do
      nil -> nil
      raw -> parse_positive_integer(raw)
    end
  end

  defp parse_positive_integer(raw) when is_binary(raw) do
    case Integer.parse(raw) do
      {value, ""} when value > 0 -> value
      _other -> nil
    end
  end

  defp reserve_port do
    {:ok, socket} = :gen_tcp.listen(0, [:binary, active: false, ip: {127, 0, 0, 1}])
    {:ok, {_address, port}} = :inet.sockname(socket)
    :ok = :gen_tcp.close(socket)
    port
  end

  defp safe_port_close(port_ref) when is_port(port_ref) do
    Port.close(port_ref)
  rescue
    _error -> :ok
  end

  defp terminate_pid(pid) when is_integer(pid) and pid > 0 do
    _ = System.cmd("kill", ["-TERM", Integer.to_string(pid)], stderr_to_stdout: true)
    :ok
  rescue
    _error -> :ok
  end

  defp terminate_pid(_pid), do: :ok
end

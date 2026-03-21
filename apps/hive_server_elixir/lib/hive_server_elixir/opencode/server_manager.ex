defmodule HiveServerElixir.Opencode.ServerManager do
  @moduledoc false

  use GenServer

  require Logger

  @default_config %{config: %{}, host: "127.0.0.1", port: 0, timeout_ms: 20_000}

  @type state :: %{
          mode: :managed | :external,
          base_url: String.t(),
          server: struct() | nil
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
  def terminate(_reason, %{mode: :managed, server: server}) when not is_nil(server) do
    OpenCode.close(%{server: server})
    :ok
  end

  def terminate(_reason, _state), do: :ok

  defp start_managed_server(opts) do
    create_server_fun = Keyword.get(opts, :create_server_fun, &OpenCode.create_server/1)

    server_opts = [
      hostname: resolve_host(opts),
      port: resolve_port(opts),
      timeout: resolve_timeout_ms(opts),
      config: resolve_server_config(opts)
    ]

    case create_server_fun.(server_opts) do
      {:ok, server} ->
        base_url = Map.fetch!(server, :url)
        Logger.info("OpenCode server mode=managed base_url=#{base_url}")
        {:ok, %{mode: :managed, base_url: base_url, server: server}}

      {:error, reason} ->
        {:stop, {:opencode_server_start_failed, reason}}
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
end

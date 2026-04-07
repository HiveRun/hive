defmodule HiveServerElixir.Opencode.ServerManagerTest do
  use ExUnit.Case, async: false

  alias HiveServerElixir.Opencode.ServerManager

  test "managed mode starts a healthy shared OpenCode server" do
    name = unique_name()
    pid = start_supervised!({ServerManager, name: name, timeout_ms: 15_000})

    assert %{mode: :managed, base_url: base_url, ready: false} = ServerManager.status(name)
    assert is_binary(base_url)
    assert base_url =~ "http://127.0.0.1:"
    assert is_pid(pid)

    wait_for_health(base_url)
  end

  test "external mode uses the configured base url without starting a managed server" do
    name = unique_name()

    assert start_supervised!(
             {ServerManager, name: name, external_base_url: "http://127.0.0.1:4123"}
           )

    assert %{mode: :external, base_url: "http://127.0.0.1:4123"} = ServerManager.status(name)
  end

  test "ensure_started rejects lazily starting the default manager" do
    assert {:error, :default_manager_must_be_supervised} =
             ServerManager.ensure_started(enabled: true)
  end

  test "ensure_started lazily starts a named manager under its supervisor" do
    name = unique_name()

    config_root =
      Path.join(
        System.tmp_dir!(),
        "opencode-server-manager-test-#{System.unique_integer([:positive])}"
      )

    File.mkdir_p!(config_root)

    assert {:ok, pid} =
             ServerManager.ensure_started(
               name: name,
               enabled: true,
               create_server_fun: fn _opts ->
                 {:ok,
                  %{
                    url: "http://127.0.0.1:4555",
                    port: nil,
                    os_pid: nil,
                    config_root: config_root
                  }}
               end
             )

    on_exit(fn ->
      case GenServer.whereis(name) do
        pid when is_pid(pid) -> GenServer.stop(pid)
        _other -> :ok
      end
    end)

    assert is_pid(pid)

    assert %{mode: :managed, base_url: base_url, ready: true} = ServerManager.status(name)
    assert is_binary(base_url)
    assert String.starts_with?(base_url, "http://127.0.0.1:")
  end

  test "startup failure surfaces the wrapped manager error" do
    name = unique_name()

    assert {:error, {{:opencode_server_start_failed, :boom}, _child}} =
             start_supervised(
               {ServerManager,
                [
                  name: name,
                  create_server_fun: fn _opts -> {:error, :boom} end
                ]}
             )
  end

  defp unique_name do
    {:global, {:opencode_server_manager, make_ref()}}
  end

  defp wait_for_health(base_url, attempts_left \\ 60)

  defp wait_for_health(_base_url, 0) do
    flunk("managed OpenCode server did not become healthy in time")
  end

  defp wait_for_health(base_url, attempts_left) do
    case Req.get(base_url <> "/global/health", retry: false) do
      {:ok, %Req.Response{status: 200}} ->
        :ok

      _other ->
        Process.sleep(250)
        wait_for_health(base_url, attempts_left - 1)
    end
  end
end

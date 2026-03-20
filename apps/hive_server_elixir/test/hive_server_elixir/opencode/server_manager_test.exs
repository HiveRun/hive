defmodule HiveServerElixir.Opencode.ServerManagerTest do
  use ExUnit.Case, async: false

  alias HiveServerElixir.Opencode.ServerManager

  setup_all do
    if System.find_executable("opencode") do
      :ok
    else
      {:skip, "opencode executable not available"}
    end
  end

  test "managed mode starts a healthy shared OpenCode server" do
    name = unique_name()
    pid = start_supervised!({ServerManager, name: name, timeout_ms: 15_000})

    assert %{mode: :managed, base_url: base_url} = ServerManager.status(name)
    assert is_binary(base_url)
    assert base_url =~ "http://127.0.0.1:"
    assert is_pid(pid)

    assert {:ok, %Req.Response{status: 200}} =
             Req.get(base_url <> "/global/health", retry: false)
  end

  test "external mode uses the configured base url without starting a managed server" do
    name = unique_name()

    assert start_supervised!(
             {ServerManager, name: name, external_base_url: "http://127.0.0.1:4123"}
           )

    assert %{mode: :external, base_url: "http://127.0.0.1:4123"} = ServerManager.status(name)
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
end

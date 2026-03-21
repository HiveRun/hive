defmodule HiveServerElixir.Opencode.ClientIntegrationTest do
  use ExUnit.Case, async: false

  alias HiveServerElixir.Opencode.Adapter
  alias HiveServerElixir.OpencodeRealServer
  alias OpenCode.Generated.Operations

  setup_all do
    server = OpencodeRealServer.start!()

    on_exit(fn ->
      OpencodeRealServer.stop(server)
    end)

    {:ok, opencode_server: server}
  end

  test "global_health uses SDK operations over the real OpenCode transport", %{
    opencode_server: server
  } do
    assert {:ok, %{"healthy" => true}} =
             Operations.global_health(OpencodeRealServer.client_opts(server))
  end

  test "config_providers uses SDK operations over the real OpenCode transport", %{
    opencode_server: server
  } do
    workspace_path = tmp_workspace_path!("client-integration")

    assert {:ok, %{"default" => defaults, "providers" => providers}} =
             Operations.config_providers(
               OpencodeRealServer.client_opts(server, directory: workspace_path)
             )

    assert defaults["opencode"] == "big-pickle"
    assert is_list(providers)
  end

  test "adapter global_event_stream normalizes callback-provided transport failures" do
    assert {:ok, stream} =
             Adapter.global_event_stream(
               global_event: fn _opts -> {:error, %{type: :transport, reason: :unreachable}} end
             )

    [item] = Enum.take(stream, 1)
    assert {:error, error} = item
    assert error.type == :transport_error
  end

  defp tmp_workspace_path!(suffix) do
    path =
      Path.join(
        System.tmp_dir!(),
        "hive-client-integration-#{suffix}-#{System.unique_integer([:positive])}"
      )

    File.mkdir_p!(path)
    File.write!(Path.join(path, "hive.config.json"), "{}")

    on_exit(fn ->
      File.rm_rf!(path)
    end)

    path
  end
end

defmodule HiveServerElixir.Opencode.AdapterTest do
  use ExUnit.Case, async: false

  alias HiveServerElixir.Opencode.Adapter
  alias HiveServerElixir.OpencodeRealServer

  setup_all do
    server = OpencodeRealServer.start!()

    on_exit(fn ->
      OpencodeRealServer.stop(server)
    end)

    {:ok, opencode_server: server}
  end

  test "health returns parsed response on success", %{opencode_server: server} do
    assert {:ok, %{"healthy" => true, "version" => version}} =
             Adapter.health(OpencodeRealServer.client_opts(server))

    assert is_binary(version)
  end

  test "health normalizes transport errors" do
    assert {:error, error} =
             Adapter.health(base_url: "http://127.0.0.1:1", timeout: 10, retry: false)

    assert error.type == :transport_error
    assert error.status == nil
  end

  test "global_event_stream returns an enumerable from callback seams" do
    payload = %{"directory" => "/tmp/project", "payload" => %{"type" => "session.idle"}}

    assert {:ok, stream} =
             Adapter.global_event_stream(global_event: fn _opts -> {:ok, payload} end)

    assert Enum.take(stream, 1) == [payload]
  end

  test "global_event_stream normalizes callback-provided HTTP errors" do
    assert {:ok, stream} =
             Adapter.global_event_stream(
               global_event: fn _opts ->
                 {:error, %{status: 503, body: %{"message" => "stream unavailable"}}}
               end
             )

    [item] = Enum.take(stream, 1)
    assert {:error, error} = item
    assert error.type == :http_error
    assert error.status == 503
  end
end

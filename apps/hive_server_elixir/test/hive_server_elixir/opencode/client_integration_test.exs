defmodule HiveServerElixir.Opencode.ClientIntegrationTest do
  use ExUnit.Case, async: true

  alias HiveServerElixir.Opencode.Adapter
  alias HiveServerElixir.OpencodeFakeServer
  alias OpenCode.Generated.Operations

  setup do
    {:ok, opencode: OpencodeFakeServer.setup_open_code_stub()}
  end

  test "global_health uses SDK operations over Req transport", %{opencode: opencode} do
    assert {:ok, %{"healthy" => true, "version" => "test"}} =
             Operations.global_health(opencode.client_opts)
  end

  test "config_providers uses SDK operations over Req transport", %{opencode: opencode} do
    assert {:ok, %{"default" => defaults, "providers" => providers}} =
             Operations.config_providers([directory: "/tmp/project"] ++ opencode.client_opts)

    assert defaults["opencode"] == "big-pickle"
    assert is_list(providers)
  end

  test "adapter global_event_stream yields SSE events through the fake transport", %{
    opencode: opencode
  } do
    payload = %{"directory" => "/tmp/project", "payload" => %{"type" => "session.idle"}}
    :ok = OpencodeFakeServer.enqueue_global_event(opencode, {:ok, payload})

    assert {:ok, stream} = Adapter.global_event_stream(opencode.adapter_opts)
    assert Enum.take(stream, 1) == [payload]
  end

  test "adapter normalizes stream transport failures" do
    assert {:ok, stream} =
             Adapter.global_event_stream(
               base_url: "http://127.0.0.1:1",
               timeout: 10,
               retry: false
             )

    [item] = Enum.take(stream, 1)
    assert {:error, error} = item

    assert error.type == :transport_error
  end
end

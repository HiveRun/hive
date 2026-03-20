defmodule HiveServerElixir.Opencode.AdapterTest do
  use ExUnit.Case, async: true

  alias HiveServerElixir.Opencode.Adapter
  alias HiveServerElixir.OpencodeFakeServer

  setup do
    {:ok, opencode: OpencodeFakeServer.setup_open_code_stub()}
  end

  test "health returns parsed response on success", %{opencode: opencode} do
    assert {:ok, %{"healthy" => true, "version" => "test"}} =
             Adapter.health(opencode.adapter_opts)
  end

  test "health normalizes HTTP errors", %{opencode: opencode} do
    :ok =
      OpencodeFakeServer.put_health(
        opencode,
        {:error, %{status: 503, body: %{"message" => "OpenCode unavailable"}}}
      )

    assert {:error, error} = Adapter.health(opencode.adapter_opts)

    assert error.type == :http_error
    assert error.status == 503
    assert error.message == "OpenCode unavailable"
  end

  test "health normalizes transport errors" do
    assert {:error, error} =
             Adapter.health(base_url: "http://127.0.0.1:1", timeout: 10, retry: false)

    assert error.type == :transport_error
    assert error.status == nil
  end

  test "global_event_stream returns an SDK-backed stream", %{opencode: opencode} do
    payload = %{"directory" => "/tmp/project", "payload" => %{"type" => "session.idle"}}
    :ok = OpencodeFakeServer.enqueue_global_event(opencode, {:ok, payload})

    assert {:ok, stream} = Adapter.global_event_stream(opencode.adapter_opts)
    assert Enum.take(stream, 1) == [payload]
  end

  test "global_event_stream normalizes HTTP errors", %{opencode: opencode} do
    :ok =
      OpencodeFakeServer.enqueue_global_event(
        opencode,
        {:error, %{status: 503, body: %{"message" => "stream unavailable"}}}
      )

    assert {:ok, stream} = Adapter.global_event_stream(opencode.adapter_opts)
    [item] = Enum.take(stream, 1)
    assert {:error, error} = item
    assert error.type == :http_error
    assert error.status == 503
  end
end

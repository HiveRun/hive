defmodule HiveServerElixir.Opencode.AdapterTest do
  use ExUnit.Case, async: true

  alias HiveServerElixir.Opencode.Adapter
  alias HiveServerElixir.Opencode.TestOperations

  test "health returns parsed response on success" do
    assert {:ok, %{"healthy" => true, "version" => "1.2.3"}} =
             Adapter.health(
               operations_module: TestOperations,
               global_health: fn _opts ->
                 {:ok, %{"healthy" => true, "version" => "1.2.3"}}
               end
             )
  end

  test "health normalizes HTTP errors" do
    assert {:error, error} =
             Adapter.health(
               operations_module: TestOperations,
               global_health: fn _opts ->
                 {:error, %{status: 503, body: %{"message" => "OpenCode unavailable"}}}
               end
             )

    assert error.type == :http_error
    assert error.status == 503
    assert error.message == "OpenCode unavailable"
  end

  test "health normalizes transport errors" do
    assert {:error, error} =
             Adapter.health(
               operations_module: TestOperations,
               global_health: fn _opts ->
                 {:error, %{type: :transport, reason: :timeout}}
               end
             )

    assert error.type == :transport_error
    assert error.status == nil
    assert error.details == :timeout
  end

  test "next_global_event returns stream payload on success" do
    payload = %{"directory" => "/tmp/project", "payload" => %{"type" => "session.idle"}}

    assert {:ok, ^payload} =
             Adapter.next_global_event(
               operations_module: TestOperations,
               global_event: fn _opts -> {:ok, payload} end
             )
  end

  test "next_global_event normalizes unknown errors" do
    assert {:error, error} =
             Adapter.next_global_event(
               operations_module: TestOperations,
               global_event: fn _opts -> :error end
             )

    assert error.type == :unknown_error
    assert error.status == nil
  end
end

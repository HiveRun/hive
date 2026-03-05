defmodule HiveServerElixir.Opencode.ClientIntegrationTest do
  use ExUnit.Case, async: true

  alias HiveServerElixir.Opencode.Adapter

  setup do
    stub_name = String.to_atom("opencode_stub_#{System.unique_integer([:positive, :monotonic])}")

    Req.Test.stub(stub_name, fn conn ->
      case conn.request_path do
        "/global/health" ->
          Req.Test.json(conn, %{healthy: true, version: "1.2.3"})

        "/global/event" ->
          Req.Test.json(conn, %{directory: "/tmp/project", payload: %{type: "session.idle"}})

        _ ->
          conn
          |> Plug.Conn.put_status(404)
          |> Req.Test.json(%{message: "not found"})
      end
    end)

    {:ok, req_options: [plug: {Req.Test, stub_name}], base_url: "http://opencode.test"}
  end

  test "health uses generated operation with Req transport", %{
    req_options: req_options,
    base_url: base_url
  } do
    assert {:ok, %{"healthy" => true, "version" => "1.2.3"}} =
             Adapter.health(req_options: req_options, base_url: base_url)
  end

  test "next_global_event uses generated stream operation", %{
    req_options: req_options,
    base_url: base_url
  } do
    assert {:ok, %{"directory" => "/tmp/project", "payload" => %{"type" => "session.idle"}}} =
             Adapter.next_global_event(req_options: req_options, base_url: base_url)
  end
end

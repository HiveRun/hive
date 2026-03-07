defmodule HiveServerElixirWeb.Plugs.RequireLocalAccessTest do
  use ExUnit.Case, async: false

  import Plug.Test

  alias HiveServerElixirWeb.Plugs.RequireLocalAccess

  setup do
    original_allow_remote = System.get_env("HIVE_ALLOW_REMOTE_ACCESS")
    System.delete_env("HIVE_ALLOW_REMOTE_ACCESS")

    on_exit(fn ->
      if original_allow_remote,
        do: System.put_env("HIVE_ALLOW_REMOTE_ACCESS", original_allow_remote),
        else: System.delete_env("HIVE_ALLOW_REMOTE_ACCESS")
    end)

    :ok
  end

  test "allows loopback requests" do
    conn = conn(:get, "/api/workspaces") |> Map.put(:remote_ip, {127, 0, 0, 1})

    refute RequireLocalAccess.call(conn, []).halted
  end

  test "rejects non-local requests by default" do
    conn = conn(:get, "/api/workspaces") |> Map.put(:remote_ip, {8, 8, 8, 8})

    conn = RequireLocalAccess.call(conn, [])

    assert conn.halted
    assert conn.status == 403
  end
end

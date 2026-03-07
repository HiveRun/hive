defmodule HiveServerElixirWeb.LocalAccessTest do
  use ExUnit.Case, async: false

  alias HiveServerElixirWeb.LocalAccess

  setup do
    original_allow_remote = System.get_env("HIVE_ALLOW_REMOTE_ACCESS")
    original_origins = System.get_env("CORS_ORIGINS")
    original_origin = System.get_env("CORS_ORIGIN")
    original_frontend_port = System.get_env("FRONTEND_PORT")
    original_backend_port = System.get_env("BACKEND_PORT")
    original_port = System.get_env("PORT")

    System.delete_env("HIVE_ALLOW_REMOTE_ACCESS")
    System.delete_env("CORS_ORIGINS")
    System.delete_env("CORS_ORIGIN")
    System.put_env("FRONTEND_PORT", "3001")
    System.put_env("BACKEND_PORT", "4000")
    System.put_env("PORT", "4000")

    on_exit(fn ->
      restore_env("HIVE_ALLOW_REMOTE_ACCESS", original_allow_remote)
      restore_env("CORS_ORIGINS", original_origins)
      restore_env("CORS_ORIGIN", original_origin)
      restore_env("FRONTEND_PORT", original_frontend_port)
      restore_env("BACKEND_PORT", original_backend_port)
      restore_env("PORT", original_port)
    end)

    :ok
  end

  test "allows default localhost frontend and backend origins" do
    assert LocalAccess.origin_allowed?(URI.parse("http://localhost:3001"))
    assert LocalAccess.origin_allowed?(URI.parse("http://127.0.0.1:4000"))
    refute LocalAccess.origin_allowed?(URI.parse("https://example.com"))
  end

  test "honors explicit configured origins" do
    System.put_env("CORS_ORIGINS", "https://app.example.com")

    assert LocalAccess.origin_allowed?(URI.parse("https://app.example.com"))
    refute LocalAccess.origin_allowed?(URI.parse("http://localhost:3001"))
  end

  defp restore_env(name, nil), do: System.delete_env(name)
  defp restore_env(name, value), do: System.put_env(name, value)
end

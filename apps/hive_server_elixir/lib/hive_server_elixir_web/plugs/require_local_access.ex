defmodule HiveServerElixirWeb.Plugs.RequireLocalAccess do
  @moduledoc false

  import Plug.Conn

  alias HiveServerElixirWeb.LocalAccess

  def init(opts), do: opts

  def call(conn, _opts) do
    if LocalAccess.allow_remote_access?() or LocalAccess.local_request?(conn) do
      conn
    else
      conn
      |> put_resp_content_type("application/json")
      |> send_resp(
        :forbidden,
        ~s({"error":{"code":"local_access_only","message":"Hive API is available only from localhost by default"}})
      )
      |> halt()
    end
  end
end

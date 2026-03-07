defmodule HiveServerElixirWeb.WebAppController do
  use HiveServerElixirWeb, :controller

  alias HiveServerElixirWeb.Plugs.StaticAssets

  def index(conn, _params) do
    case StaticAssets.index_file_path() do
      path when is_binary(path) ->
        conn
        |> put_resp_content_type("text/html")
        |> send_file(200, path)

      _other ->
        send_resp(conn, 404, "Not Found")
    end
  end
end

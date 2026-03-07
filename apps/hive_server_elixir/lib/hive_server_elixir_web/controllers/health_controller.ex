defmodule HiveServerElixirWeb.HealthController do
  use HiveServerElixirWeb, :controller

  def show(conn, _params) do
    json(conn, %{status: "ok"})
  end
end

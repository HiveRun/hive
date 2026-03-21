defmodule HiveServerElixirWeb.AshTypescriptRpcController do
  use HiveServerElixirWeb, :controller

  def run(conn, params) do
    result = AshTypescript.Rpc.run_action(:hive_server_elixir, conn, params)
    json(conn, result)
  end

  def validate(conn, params) do
    result = AshTypescript.Rpc.validate_action(:hive_server_elixir, conn, params)
    json(conn, result)
  end
end

defmodule HiveServerElixir.Repo do
  use AshSqlite.Repo,
    otp_app: :hive_server_elixir
end

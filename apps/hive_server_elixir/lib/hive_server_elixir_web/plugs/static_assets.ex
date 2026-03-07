defmodule HiveServerElixirWeb.Plugs.StaticAssets do
  @moduledoc false

  @behaviour Plug

  @embedded_static_options Plug.Static.init(
                             at: "/",
                             from: :hive_server_elixir,
                             gzip: false,
                             only: HiveServerElixirWeb.static_paths()
                           )

  def init(opts), do: opts

  def call(conn, _opts) do
    case web_dist_root() do
      nil -> Plug.Static.call(conn, @embedded_static_options)
      root -> Plug.Static.call(conn, Plug.Static.init(at: "/", from: root, gzip: false))
    end
  end

  def web_dist_root do
    case System.get_env("HIVE_WEB_DIST") do
      path when is_binary(path) and path != "" ->
        expanded = Path.expand(path)

        if File.exists?(Path.join(expanded, "index.html")) do
          expanded
        else
          nil
        end

      _other ->
        nil
    end
  end

  def index_file_path do
    case web_dist_root() do
      nil ->
        path = Application.app_dir(:hive_server_elixir, "priv/static/index.html")
        if File.exists?(path), do: path, else: nil

      root ->
        Path.join(root, "index.html")
    end
  end
end

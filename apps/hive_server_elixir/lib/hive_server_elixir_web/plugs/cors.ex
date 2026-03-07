defmodule HiveServerElixirWeb.Plugs.Cors do
  @moduledoc false

  import Plug.Conn

  @default_allowed_headers [
    "authorization",
    "content-type",
    "x-workspace-id",
    "x-hive-source",
    "x-hive-tool",
    "x-hive-audit-event",
    "x-hive-service-name"
  ]

  @default_allowed_methods "GET,POST,PUT,PATCH,DELETE,OPTIONS"
  @default_max_age "86400"

  def init(opts), do: opts

  def call(conn, _opts) do
    allowed_origins = allowed_origins()
    request_origin = get_req_header(conn, "origin") |> List.first()
    allow_origin = resolve_allow_origin(request_origin, allowed_origins)

    conn =
      conn
      |> maybe_put_access_control_allow_origin(allow_origin)
      |> put_resp_header("vary", "origin")
      |> put_resp_header("access-control-allow-methods", @default_allowed_methods)
      |> put_resp_header("access-control-allow-headers", allowed_headers(conn))
      |> put_resp_header("access-control-max-age", @default_max_age)

    if conn.method == "OPTIONS" do
      conn
      |> send_resp(:no_content, "")
      |> halt()
    else
      conn
    end
  end

  defp allowed_origins do
    case System.get_env("CORS_ORIGIN") do
      nil ->
        ["*"]

      "" ->
        ["*"]

      value ->
        value
        |> String.split(",", trim: true)
        |> Enum.map(&String.trim/1)
        |> Enum.reject(&(&1 == ""))
        |> case do
          [] -> ["*"]
          origins -> origins
        end
    end
  end

  defp resolve_allow_origin(nil, ["*"]), do: "*"
  defp resolve_allow_origin(nil, _allowed_origins), do: nil

  defp resolve_allow_origin(request_origin, allowed_origins) do
    cond do
      "*" in allowed_origins -> request_origin
      request_origin in allowed_origins -> request_origin
      true -> nil
    end
  end

  defp maybe_put_access_control_allow_origin(conn, nil), do: conn

  defp maybe_put_access_control_allow_origin(conn, value) do
    put_resp_header(conn, "access-control-allow-origin", value)
  end

  defp allowed_headers(conn) do
    case get_req_header(conn, "access-control-request-headers") do
      [value | _rest] when is_binary(value) ->
        trimmed_value = String.trim(value)

        if byte_size(trimmed_value) > 0 do
          trimmed_value
        else
          Enum.join(@default_allowed_headers, ",")
        end

      _other ->
        Enum.join(@default_allowed_headers, ",")
    end
  end
end

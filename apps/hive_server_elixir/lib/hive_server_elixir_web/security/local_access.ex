defmodule HiveServerElixirWeb.LocalAccess do
  @moduledoc false

  @frontend_default_port "3001"
  @backend_default_port "4000"

  @spec allow_remote_access?() :: boolean()
  def allow_remote_access? do
    truthy_env?("HIVE_ALLOW_REMOTE_ACCESS")
  end

  @spec local_bind_ip() :: :inet.ip_address()
  def local_bind_ip do
    if allow_remote_access?() do
      {0, 0, 0, 0}
    else
      {127, 0, 0, 1}
    end
  end

  @spec allowed_origins() :: [String.t()]
  def allowed_origins do
    configured_origins = configured_origins()

    cond do
      configured_origins != [] -> configured_origins
      allow_remote_access?() -> ["*"]
      true -> default_local_origins()
    end
  end

  @spec origin_allowed?(URI.t()) :: boolean()
  def origin_allowed?(%URI{} = uri) do
    allow_remote_access?() or origin_matches?(normalize_origin(uri), allowed_origins())
  end

  @spec local_request?(Plug.Conn.t()) :: boolean()
  def local_request?(%Plug.Conn{remote_ip: remote_ip}) do
    loopback_ip?(remote_ip)
  end

  defp configured_origins do
    [System.get_env("CORS_ORIGINS"), System.get_env("CORS_ORIGIN")]
    |> Enum.reject(&is_nil/1)
    |> Enum.flat_map(&String.split(&1, ",", trim: true))
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
    |> Enum.uniq()
  end

  defp default_local_origins do
    frontend_port = System.get_env("FRONTEND_PORT") || @frontend_default_port

    backend_port =
      System.get_env("BACKEND_PORT") || System.get_env("PORT") || @backend_default_port

    [frontend_port, backend_port]
    |> Enum.uniq()
    |> Enum.flat_map(fn port ->
      [
        "http://localhost:#{port}",
        "http://127.0.0.1:#{port}",
        "http://[::1]:#{port}",
        "https://localhost:#{port}",
        "https://127.0.0.1:#{port}",
        "https://[::1]:#{port}"
      ]
    end)
  end

  defp origin_matches?(_origin, ["*"]), do: true
  defp origin_matches?(nil, _allowed_origins), do: false

  defp origin_matches?(origin, allowed_origins) do
    origin in Enum.map(allowed_origins, &normalize_origin/1)
  end

  defp normalize_origin(%URI{} = uri) do
    if uri.scheme && uri.host do
      port_suffix = if uri.port, do: ":#{uri.port}", else: ""
      "#{String.downcase(uri.scheme)}://#{String.downcase(uri.host)}#{port_suffix}"
    else
      nil
    end
  end

  defp normalize_origin(origin) when is_binary(origin) do
    origin
    |> String.trim()
    |> URI.parse()
    |> normalize_origin()
  end

  defp normalize_origin(_origin), do: nil

  defp loopback_ip?({127, _, _, _}), do: true
  defp loopback_ip?({0, 0, 0, 0, 0, 0, 0, 1}), do: true
  defp loopback_ip?({0, 0, 0, 0, 0, 65535, 32512, _last}), do: true
  defp loopback_ip?(_remote_ip), do: false

  defp truthy_env?(name) do
    case System.get_env(name) do
      value when value in ["1", "true", "TRUE", "yes", "YES"] -> true
      _other -> false
    end
  end
end

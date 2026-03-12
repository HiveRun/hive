defmodule HiveServerElixirWeb.Cells.StreamTransport do
  @moduledoc false

  alias HiveServerElixir.Cells.Terminals.Transport

  def open_sse(conn) do
    conn
    |> Plug.Conn.put_resp_content_type("text/event-stream")
    |> Plug.Conn.put_resp_header("cache-control", "no-cache")
    |> Plug.Conn.put_resp_header("connection", "keep-alive")
    |> Plug.Conn.send_chunked(200)
  end

  def send_event(conn, event, data) do
    encoded = Jason.encode!(data)

    conn
    |> Plug.Conn.chunk("event: #{event}\ndata: #{encoded}\n\n")
    |> case do
      {:ok, next_conn} -> {:ok, next_conn}
      {:error, reason} -> {:error, reason}
    end
  end

  def idle_timeout_ms(nil, default), do: default

  def idle_timeout_ms(value, default) when is_binary(value) do
    case Integer.parse(value) do
      {timeout, ""} when timeout >= 0 -> timeout
      _ -> default
    end
  end

  def idle_timeout_ms(_value, default), do: default

  def parse_input(params) do
    case read_param(params, "data") do
      value when is_binary(value) -> {:ok, value}
      _value -> {:error, :invalid_input}
    end
  end

  def parse_resize_params(params) do
    cols = parse_positive_integer(read_param(params, "cols"))
    rows = parse_positive_integer(read_param(params, "rows"))

    if is_integer(cols) and is_integer(rows) do
      {:ok, cols, rows}
    else
      {:error, :invalid_resize}
    end
  end

  def stream_terminal_events(conn, scope, idle_timeout_ms) do
    receive do
      message ->
        case Transport.sse_event(message, scope) do
          {:ok, event, payload} ->
            case send_event(conn, event, payload) do
              {:ok, next_conn} ->
                stream_terminal_events(next_conn, scope, idle_timeout_ms)

              {:error, _reason} ->
                conn
            end

          :ignore ->
            stream_terminal_events(conn, scope, idle_timeout_ms)
        end
    after
      idle_timeout_ms ->
        conn
    end
  end

  defp parse_positive_integer(value) when is_integer(value) and value > 0, do: value

  defp parse_positive_integer(value) when is_binary(value) do
    case Integer.parse(value) do
      {parsed, ""} when parsed > 0 -> parsed
      _result -> nil
    end
  end

  defp parse_positive_integer(_value), do: nil

  defp read_param(params, key, fallback_key \\ nil) do
    Map.get(params, key) || if(fallback_key, do: Map.get(params, fallback_key), else: nil)
  end
end

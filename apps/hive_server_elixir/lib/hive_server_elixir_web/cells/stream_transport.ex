defmodule HiveServerElixirWeb.Cells.StreamTransport do
  @moduledoc false

  alias HiveServerElixirWeb.TerminalEvents

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

  def stream_setup_terminal_events(conn, cell_id, idle_timeout_ms) do
    receive do
      {:setup_terminal_data, %{cell_id: ^cell_id, chunk: chunk}} ->
        case send_event(conn, "data", TerminalEvents.data_payload(chunk)) do
          {:ok, next_conn} -> stream_setup_terminal_events(next_conn, cell_id, idle_timeout_ms)
          {:error, _reason} -> conn
        end

      {:setup_terminal_exit, %{cell_id: ^cell_id, exit_code: exit_code, signal: signal}} ->
        case send_event(conn, "exit", TerminalEvents.exit_payload(exit_code, signal)) do
          {:ok, next_conn} -> stream_setup_terminal_events(next_conn, cell_id, idle_timeout_ms)
          {:error, _reason} -> conn
        end

      {:setup_terminal_error, %{cell_id: ^cell_id, message: message}} ->
        case send_event(conn, "error", TerminalEvents.error_payload(message)) do
          {:ok, next_conn} -> stream_setup_terminal_events(next_conn, cell_id, idle_timeout_ms)
          {:error, _reason} -> conn
        end
    after
      idle_timeout_ms ->
        conn
    end
  end

  def stream_service_terminal_events(conn, cell_id, service_id, idle_timeout_ms) do
    receive do
      {:service_terminal_data, %{cell_id: ^cell_id, service_id: ^service_id, chunk: chunk}} ->
        case send_event(conn, "data", TerminalEvents.data_payload(chunk)) do
          {:ok, next_conn} ->
            stream_service_terminal_events(next_conn, cell_id, service_id, idle_timeout_ms)

          {:error, _reason} ->
            conn
        end

      {:service_terminal_exit,
       %{cell_id: ^cell_id, service_id: ^service_id, exit_code: exit_code, signal: signal}} ->
        case send_event(conn, "exit", TerminalEvents.exit_payload(exit_code, signal)) do
          {:ok, next_conn} ->
            stream_service_terminal_events(next_conn, cell_id, service_id, idle_timeout_ms)

          {:error, _reason} ->
            conn
        end

      {:service_terminal_error, %{cell_id: ^cell_id, service_id: ^service_id, message: message}} ->
        case send_event(conn, "error", TerminalEvents.error_payload(message)) do
          {:ok, next_conn} ->
            stream_service_terminal_events(next_conn, cell_id, service_id, idle_timeout_ms)

          {:error, _reason} ->
            conn
        end
    after
      idle_timeout_ms ->
        conn
    end
  end

  def stream_chat_terminal_events(conn, cell_id, idle_timeout_ms) do
    receive do
      {:chat_terminal_data, %{cell_id: ^cell_id, chunk: chunk}} ->
        case send_event(conn, "data", TerminalEvents.data_payload(chunk)) do
          {:ok, next_conn} -> stream_chat_terminal_events(next_conn, cell_id, idle_timeout_ms)
          {:error, _reason} -> conn
        end

      {:chat_terminal_exit, %{cell_id: ^cell_id, exit_code: exit_code, signal: signal}} ->
        case send_event(conn, "exit", TerminalEvents.exit_payload(exit_code, signal)) do
          {:ok, next_conn} -> stream_chat_terminal_events(next_conn, cell_id, idle_timeout_ms)
          {:error, _reason} -> conn
        end

      {:chat_terminal_error, %{cell_id: ^cell_id, message: message}} ->
        case send_event(conn, "error", TerminalEvents.error_payload(message)) do
          {:ok, next_conn} -> stream_chat_terminal_events(next_conn, cell_id, idle_timeout_ms)
          {:error, _reason} -> conn
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

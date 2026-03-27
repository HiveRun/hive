defmodule HiveServerElixirWeb.Cells.Streams do
  @moduledoc false

  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.ServiceSnapshot
  alias HiveServerElixirWeb.Cells.StreamTransport

  @service_stream_heartbeat_ms 15_000

  def send_services_snapshot(conn, cell_id, params) do
    cell_id
    |> ServiceSnapshot.list_transport_payloads(parse_log_options(params))
    |> Enum.reduce_while({:ok, conn}, fn service_payload, {:ok, stream_conn} ->
      case StreamTransport.send_event(stream_conn, "service", service_payload) do
        {:ok, next_conn} -> {:cont, {:ok, next_conn}}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  def stream_service_events(conn, cell_id, params) do
    receive do
      {:service_update, %{cell_id: ^cell_id, service_id: service_id}} ->
        case Ash.get(Service, service_id, domain: Cells) do
          {:ok, service} ->
            case StreamTransport.send_event(
                   conn,
                   "service",
                   ServiceSnapshot.transport_payload(service, parse_log_options(params))
                 ) do
              {:ok, next_conn} -> stream_service_events(next_conn, cell_id, params)
              {:error, _reason} -> conn
            end

          {:error, _reason} ->
            stream_service_events(conn, cell_id, params)
        end
    after
      @service_stream_heartbeat_ms ->
        case StreamTransport.send_event(conn, "heartbeat", %{
               timestamp: System.system_time(:millisecond)
             }) do
          {:ok, next_conn} -> stream_service_events(next_conn, cell_id, params)
          {:error, _reason} -> conn
        end
    end
  end

  defp parse_log_options(params) do
    lines = parse_log_lines(Map.get(params, "logLines"))
    offset = parse_log_offset(Map.get(params, "logOffset"))
    include_resources = parse_boolean_param(Map.get(params, "includeResources"), false)
    %{lines: lines, offset: offset, include_resources: include_resources}
  end

  defp parse_boolean_param(value, _default) when is_boolean(value), do: value
  defp parse_boolean_param("true", _default), do: true
  defp parse_boolean_param("1", _default), do: true
  defp parse_boolean_param("false", _default), do: false
  defp parse_boolean_param("0", _default), do: false
  defp parse_boolean_param(_value, default), do: default

  defp parse_log_lines(value) when is_integer(value), do: clamp(value, 1, 2_000)

  defp parse_log_lines(value) when is_binary(value) do
    case Integer.parse(value) do
      {parsed, ""} -> clamp(parsed, 1, 2_000)
      _result -> 200
    end
  end

  defp parse_log_lines(_value), do: 200

  defp parse_log_offset(value) when is_integer(value), do: max(value, 0)

  defp parse_log_offset(value) when is_binary(value) do
    case Integer.parse(value) do
      {parsed, ""} -> max(parsed, 0)
      _result -> 0
    end
  end

  defp parse_log_offset(_value), do: 0

  defp clamp(value, min, _max) when value < min, do: min
  defp clamp(value, _min, max) when value > max, do: max
  defp clamp(value, _min, _max), do: value
end

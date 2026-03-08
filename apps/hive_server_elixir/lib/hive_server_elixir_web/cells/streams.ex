defmodule HiveServerElixirWeb.Cells.Streams do
  @moduledoc false

  import Ash.Expr
  require Ash.Query

  alias Ash.Error.Query.NotFound
  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.ServiceSnapshot
  alias HiveServerElixir.Cells.Timing
  alias HiveServerElixir.Cells.Workspace
  alias HiveServerElixirWeb.Cells.StreamTransport
  alias HiveServerElixirWeb.CellsSerializer

  @service_stream_heartbeat_ms 15_000

  def send_workspace_snapshot(conn, workspace_id) do
    Cell
    |> Ash.Query.filter(expr(workspace_id == ^workspace_id))
    |> Ash.Query.sort(inserted_at: :asc)
    |> Ash.read(domain: Cells)
    |> case do
      {:ok, cells} ->
        workspaces = preload_workspaces(cells)

        Enum.reduce_while(cells, {:ok, conn}, fn cell, {:ok, stream_conn} ->
          payload = serialize_cell(cell, %{workspace: Map.get(workspaces, cell.workspace_id)})

          case StreamTransport.send_event(stream_conn, "cell", payload) do
            {:ok, next_conn} -> {:cont, {:ok, next_conn}}
            {:error, reason} -> {:halt, {:error, reason}}
          end
        end)

      {:error, reason} ->
        {:error, reason}
    end
  end

  def stream_workspace_events(conn, workspace_id, idle_timeout_ms) do
    receive do
      {:cell_status, %{workspace_id: ^workspace_id, cell_id: cell_id}} ->
        case Ash.get(Cell, cell_id, domain: Cells) do
          {:ok, cell} ->
            workspace = fetch_workspace(cell.workspace_id)

            case StreamTransport.send_event(
                   conn,
                   "cell",
                   serialize_cell(cell, %{workspace: workspace})
                 ) do
              {:ok, next_conn} ->
                stream_workspace_events(next_conn, workspace_id, idle_timeout_ms)

              {:error, _reason} ->
                conn
            end

          {:error, %NotFound{}} ->
            case StreamTransport.send_event(conn, "cell_removed", %{id: cell_id}) do
              {:ok, next_conn} ->
                stream_workspace_events(next_conn, workspace_id, idle_timeout_ms)

              {:error, _reason} ->
                conn
            end

          {:error, _reason} ->
            stream_workspace_events(conn, workspace_id, idle_timeout_ms)
        end

      {:cell_removed, %{workspace_id: ^workspace_id, cell_id: cell_id}} ->
        case StreamTransport.send_event(conn, "cell_removed", %{id: cell_id}) do
          {:ok, next_conn} -> stream_workspace_events(next_conn, workspace_id, idle_timeout_ms)
          {:error, _reason} -> conn
        end
    after
      idle_timeout_ms ->
        conn
    end
  end

  def send_timing_snapshot(conn, cell_id) do
    Timing
    |> Ash.Query.filter(expr(cell_id == ^cell_id))
    |> Ash.Query.sort(inserted_at: :asc)
    |> Ash.read(domain: Cells)
    |> case do
      {:ok, timings} ->
        Enum.reduce_while(timings, {:ok, conn}, fn timing, {:ok, stream_conn} ->
          case StreamTransport.send_event(stream_conn, "timing", serialize_timing(timing)) do
            {:ok, next_conn} -> {:cont, {:ok, next_conn}}
            {:error, reason} -> {:halt, {:error, reason}}
          end
        end)

      {:error, reason} ->
        {:error, reason}
    end
  end

  def stream_timing_events(conn, cell_id, idle_timeout_ms) do
    receive do
      {:cell_timing, %{cell_id: ^cell_id, timing_id: timing_id}} ->
        case Ash.get(Timing, timing_id, domain: Cells) do
          {:ok, timing} ->
            case StreamTransport.send_event(conn, "timing", serialize_timing(timing)) do
              {:ok, next_conn} -> stream_timing_events(next_conn, cell_id, idle_timeout_ms)
              {:error, _reason} -> conn
            end

          {:error, _reason} ->
            stream_timing_events(conn, cell_id, idle_timeout_ms)
        end
    after
      idle_timeout_ms ->
        conn
    end
  end

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

  defp fetch_workspace(workspace_id) when is_binary(workspace_id) do
    case Ash.get(Workspace, workspace_id, domain: Cells) do
      {:ok, workspace} -> workspace
      {:error, _error} -> nil
    end
  end

  defp fetch_workspace(_workspace_id), do: nil

  defp preload_workspaces(cells) when is_list(cells) do
    cells
    |> Enum.map(& &1.workspace_id)
    |> Enum.uniq()
    |> Enum.reduce(%{}, fn workspace_id, acc ->
      case fetch_workspace(workspace_id) do
        nil -> acc
        workspace -> Map.put(acc, workspace_id, workspace)
      end
    end)
  end

  defp serialize_cell(%Cell{} = cell, opts) do
    CellsSerializer.serialize_cell(cell,
      workspace: Map.get(opts, :workspace),
      include_setup_log: Map.get(opts, :include_setup_log, false)
    )
  end

  defp serialize_timing(nil), do: nil

  defp serialize_timing(%Timing{} = timing) do
    %{
      id: timing.id,
      cellId: timing.cell_id,
      cellName: timing.cell_name,
      workspaceId: timing.workspace_id,
      templateId: timing.template_id,
      runId: timing.run_id,
      workflow: timing.workflow,
      step: timing.step,
      status: timing.status,
      attempt: timing.attempt,
      error: timing.error,
      metadata: timing.metadata,
      durationMs: timing.duration_ms,
      createdAt: maybe_to_iso8601(timing.inserted_at)
    }
  end

  defp maybe_to_iso8601(nil), do: nil
  defp maybe_to_iso8601(datetime), do: DateTime.to_iso8601(datetime)

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

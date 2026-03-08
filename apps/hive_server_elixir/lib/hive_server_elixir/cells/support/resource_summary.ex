defmodule HiveServerElixir.Cells.ResourceSummary do
  @moduledoc false

  import Ash.Expr
  require Ash.Query

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.ServiceReconciliation
  alias HiveServerElixir.Cells.ServiceStatus

  @average_windows ["1m", "5m", "15m", "1h"]

  @spec build(Cell.t(), map()) :: map()
  def build(%Cell{} = cell, opts \\ %{}) do
    sampled_at = DateTime.utc_now() |> DateTime.truncate(:second) |> DateTime.to_iso8601()

    services =
      Service
      |> Ash.Query.filter(expr(cell_id == ^cell.id))
      |> Ash.Query.sort(inserted_at: :asc)
      |> Ash.read!(domain: Cells)

    processes =
      services
      |> ServiceReconciliation.reconcile_all()
      |> Enum.map(&serialize_service_process(&1, sampled_at))

    summary =
      %{
        cellId: cell.id,
        sampledAt: sampled_at,
        processCount: length(processes),
        activeProcessCount: Enum.count(processes, & &1.active),
        tracked: %{
          services: length(processes),
          opencode: 0,
          terminal: 0,
          setup: 0
        },
        totalCpuPercent: total_metric(processes, :cpuPercent),
        totalRssBytes: total_metric(processes, :rssBytes),
        activeCpuPercent: active_metric(processes, :cpuPercent),
        activeRssBytes: active_metric(processes, :rssBytes),
        processes: processes
      }

    summary
    |> maybe_put_history(opts)
    |> maybe_put_history_averages(opts)
    |> maybe_put_rollups(opts)
  end

  defp maybe_put_history(summary, %{include_history: true} = opts) do
    history_limit = Map.get(opts, :history_limit, 180)
    point = history_point(summary)

    history =
      [point]
      |> Enum.take(max(history_limit, 1))

    Map.put(summary, :history, history)
  end

  defp maybe_put_history(summary, _opts), do: summary

  defp maybe_put_history_averages(summary, %{include_averages: true}) do
    averages =
      Enum.map(@average_windows, fn window ->
        %{
          window: window,
          sampleCount: 1,
          averageActiveCpuPercent: summary.activeCpuPercent,
          averageActiveRssBytes: summary.activeRssBytes,
          peakActiveCpuPercent: summary.activeCpuPercent,
          peakActiveRssBytes: summary.activeRssBytes
        }
      end)

    Map.put(summary, :historyAverages, averages)
  end

  defp maybe_put_history_averages(summary, _opts), do: summary

  defp maybe_put_rollups(summary, %{include_rollups: true} = opts) do
    rollup_limit = Map.get(opts, :rollup_limit, 96)

    rollups =
      [
        %{
          bucketStartAt: summary.sampledAt,
          sampleCount: 1,
          averageActiveCpuPercent: summary.activeCpuPercent,
          averageActiveRssBytes: summary.activeRssBytes,
          peakActiveCpuPercent: summary.activeCpuPercent,
          peakActiveRssBytes: summary.activeRssBytes
        }
      ]
      |> Enum.take(max(rollup_limit, 1))

    Map.put(summary, :rollups, rollups)
  end

  defp maybe_put_rollups(summary, _opts), do: summary

  defp history_point(summary) do
    %{
      sampledAt: summary.sampledAt,
      processCount: summary.processCount,
      activeProcessCount: summary.activeProcessCount,
      totalCpuPercent: summary.totalCpuPercent,
      totalRssBytes: summary.totalRssBytes,
      activeCpuPercent: summary.activeCpuPercent,
      activeRssBytes: summary.activeRssBytes,
      processes: summary.processes
    }
  end

  defp serialize_service_process(%{service: service} = snapshot, sampled_at) do
    presented_status = ServiceStatus.present(snapshot.status)

    %{
      kind: "service",
      serviceType: service.type,
      id: service.id,
      name: service.name,
      status: presented_status,
      pid: snapshot.pid,
      processAlive: snapshot.process_alive,
      active: snapshot.process_alive and ServiceStatus.running?(snapshot.status),
      cpuPercent: nil,
      rssBytes: nil,
      resourceSampledAt: sampled_at,
      resourceUnavailableReason: unavailable_reason(snapshot.pid, snapshot.process_alive)
    }
  end

  defp unavailable_reason(pid, _process_alive) when not is_integer(pid), do: "pid_missing"
  defp unavailable_reason(_pid, false), do: "process_not_alive"
  defp unavailable_reason(_pid, true), do: "sample_failed"

  defp total_metric(processes, key) do
    Enum.reduce(processes, 0, fn process, total ->
      total + normalize_number(Map.get(process, key))
    end)
  end

  defp active_metric(processes, key) do
    Enum.reduce(processes, 0, fn process, total ->
      if process.active do
        total + normalize_number(Map.get(process, key))
      else
        total
      end
    end)
  end

  defp normalize_number(value) when is_integer(value), do: value
  defp normalize_number(value) when is_float(value), do: value
  defp normalize_number(_value), do: 0
end

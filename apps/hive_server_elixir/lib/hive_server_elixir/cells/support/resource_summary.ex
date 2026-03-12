defmodule HiveServerElixir.Cells.ResourceSummary do
  @moduledoc false

  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.ServiceReconciliation

  @average_windows ["1m", "5m", "15m", "1h"]

  @spec build(Cell.t(), map()) :: map()
  def build(%Cell{} = cell, opts \\ %{}) do
    sampled_at = DateTime.utc_now() |> DateTime.truncate(:second) |> DateTime.to_iso8601()

    processes =
      cell.id
      |> Service.list_for_cell()
      |> ServiceReconciliation.reconcile_all()
      |> Enum.map(&Service.process_summary_payload(&1, sampled_at))

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

defmodule HiveServerElixir.Cells.Lifecycle do
  @moduledoc """
  Lifecycle entrypoints for starting and stopping OpenCode event ingest per cell.
  """

  alias HiveServerElixir.Opencode.EventIngestRuntime

  @spec on_cell_create(map, keyword) :: DynamicSupervisor.on_start_child()
  def on_cell_create(context, opts \\ []) when is_map(context) do
    EventIngestRuntime.start_stream(context, opts)
  end

  @spec on_cell_retry(map, keyword) :: DynamicSupervisor.on_start_child()
  def on_cell_retry(context, opts \\ []) when is_map(context) do
    restart_stream(context, opts)
  end

  @spec on_cell_resume(map, keyword) :: DynamicSupervisor.on_start_child()
  def on_cell_resume(context, opts \\ []) when is_map(context) do
    restart_stream(context, opts)
  end

  @spec on_cell_delete(map) :: :ok
  def on_cell_delete(context) when is_map(context) do
    case EventIngestRuntime.stop_stream(context) do
      :ok -> :ok
      {:error, :not_found} -> :ok
    end
  end

  defp restart_stream(context, opts) do
    _ = EventIngestRuntime.stop_stream(context)
    EventIngestRuntime.start_stream(context, opts)
  end
end

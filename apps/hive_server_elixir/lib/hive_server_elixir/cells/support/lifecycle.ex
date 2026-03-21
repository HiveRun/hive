defmodule HiveServerElixir.Cells.Lifecycle do
  @moduledoc """
  Lifecycle entrypoints for starting and stopping OpenCode event ingest per cell.
  """

  alias HiveServerElixir.Opencode.EventIngestRuntime
  alias HiveServerElixir.Cells.TerminalEvents

  @spec on_cell_create(map, keyword) :: DynamicSupervisor.on_start_child()
  def on_cell_create(context, opts \\ []) when is_map(context) do
    context
    |> EventIngestRuntime.start_stream(opts)
    |> handle_start_stream_result(context, emit_started?: true)
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
    result =
      case EventIngestRuntime.stop_stream(context) do
        :ok -> :ok
        {:error, :not_found} -> :ok
      end

    :ok = TerminalEvents.on_cell_stopped(context)
    result
  end

  defp restart_stream(context, opts) do
    _ = EventIngestRuntime.stop_stream(context)

    context
    |> EventIngestRuntime.start_stream(opts)
    |> handle_start_stream_result(context)
  end

  @doc false
  @spec handle_start_stream_result(DynamicSupervisor.on_start_child(), map, keyword) ::
          DynamicSupervisor.on_start_child()
  def handle_start_stream_result(result, context, opts \\ []) when is_map(context) do
    case result do
      {:ok, _pid} = ok ->
        if Keyword.get(opts, :emit_started?, false) do
          :ok = TerminalEvents.on_cell_started(context)
        end

        ok

      {:error, reason} = error ->
        :ok = TerminalEvents.on_cell_error(context, inspect(reason))
        error
    end
  end
end

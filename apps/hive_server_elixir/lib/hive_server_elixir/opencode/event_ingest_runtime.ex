defmodule HiveServerElixir.Opencode.EventIngestRuntime do
  @moduledoc """
  Starts and stops continuous OpenCode global-event ingest workers per cell context.
  """

  alias HiveServerElixir.Opencode.EventIngestWorker

  @registry HiveServerElixir.Opencode.EventIngestRegistry
  @supervisor HiveServerElixir.Opencode.EventIngestSupervisor

  @spec start_stream(map, keyword) :: DynamicSupervisor.on_start_child()
  def start_stream(context, opts \\ []) when is_map(context) do
    normalized_context = normalize_context(context)

    worker_opts = [
      name: via_tuple(normalized_context),
      context: normalized_context,
      adapter_opts: Keyword.get(opts, :adapter_opts, []),
      success_delay_ms: Keyword.get(opts, :success_delay_ms, 0),
      error_delay_ms: Keyword.get(opts, :error_delay_ms, 1_000)
    ]

    DynamicSupervisor.start_child(@supervisor, {EventIngestWorker, worker_opts})
  end

  @spec stop_stream(map) :: :ok | {:error, :not_found}
  def stop_stream(context) when is_map(context) do
    normalized_context = normalize_context(context)

    case Registry.lookup(@registry, context_key(normalized_context)) do
      [{pid, _value}] -> DynamicSupervisor.terminate_child(@supervisor, pid)
      [] -> {:error, :not_found}
    end
  end

  defp via_tuple(context) do
    {:via, Registry, {@registry, context_key(context)}}
  end

  defp context_key(context) do
    {context.workspace_id, context.cell_id}
  end

  defp normalize_context(context) do
    workspace_id = get_context_value(context, :workspace_id)
    cell_id = get_context_value(context, :cell_id)

    if workspace_id == nil or cell_id == nil do
      raise ArgumentError, "event ingest context requires workspace_id and cell_id"
    end

    %{
      workspace_id: workspace_id,
      cell_id: cell_id,
      session_id: get_context_value(context, :session_id),
      seq: get_context_value(context, :seq)
    }
  end

  defp get_context_value(context, key) when is_atom(key) do
    Map.get(context, key) || Map.get(context, Atom.to_string(key))
  end
end

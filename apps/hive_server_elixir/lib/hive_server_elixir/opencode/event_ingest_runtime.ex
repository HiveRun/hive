defmodule HiveServerElixir.Opencode.EventIngestRuntime do
  @moduledoc """
  Starts and stops continuous OpenCode global-event ingest workers per cell context.
  """

  alias HiveServerElixir.Opencode.EventIngestWorker
  alias HiveServerElixir.Opencode.EventIngestContext
  alias HiveServerElixir.Opencode.AgentEventLog
  alias HiveServerElixir.Cells.TerminalEvents

  @registry HiveServerElixir.Opencode.EventIngestRegistry
  @supervisor HiveServerElixir.Opencode.EventIngestSupervisor

  @spec start_stream(map, keyword) :: DynamicSupervisor.on_start_child()
  def start_stream(context, opts \\ []) when is_map(context) do
    normalized_context = EventIngestContext.normalize(context)
    raw_adapter_opts = Keyword.get(opts, :adapter_opts, [])

    worker_opts = [
      name: via_tuple(normalized_context),
      context: normalized_context,
      adapter_opts: Keyword.delete(raw_adapter_opts, :persist_global_event),
      persist_global_event:
        Keyword.get(opts, :persist_global_event) ||
          Keyword.get(
            raw_adapter_opts,
            :persist_global_event,
            &AgentEventLog.append_global_event/2
          ),
      success_delay_ms: Keyword.get(opts, :success_delay_ms, 0),
      error_delay_ms: Keyword.get(opts, :error_delay_ms, 1_000),
      project_global_event:
        Keyword.get(opts, :project_global_event, &TerminalEvents.project_opencode_event/2)
    ]

    DynamicSupervisor.start_child(@supervisor, {EventIngestWorker, worker_opts})
  end

  @spec stop_stream(map) :: :ok | {:error, :not_found}
  def stop_stream(context) when is_map(context) do
    normalized_context = EventIngestContext.normalize(context)

    case Registry.lookup(@registry, context_key(normalized_context)) do
      [{pid, _value}] -> DynamicSupervisor.terminate_child(@supervisor, pid)
      [] -> {:error, :not_found}
    end
  end

  defp via_tuple(context) do
    {:via, Registry, {@registry, context_key(context)}}
  end

  defp context_key(context) do
    EventIngestContext.key(context)
  end
end

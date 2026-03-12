defmodule HiveServerElixir.Opencode.EventIngest do
  @moduledoc """
  Stream ingest entrypoint that pulls one OpenCode global event and persists it.
  """

  alias HiveServerElixir.Opencode.Adapter
  alias HiveServerElixir.Opencode.AgentEventLog
  alias HiveServerElixir.Opencode.EventIngestContext

  @spec ingest_next(map, keyword) :: {:ok, map} | {:error, Adapter.normalized_error()}
  def ingest_next(context, opts \\ []) when is_map(context) do
    normalized_context = EventIngestContext.normalize(context)

    persist_global_event =
      Keyword.get(opts, :persist_global_event, &AgentEventLog.append_global_event/2)

    case Adapter.next_global_event(Keyword.delete(opts, :persist_global_event)) do
      {:ok, event} ->
        case persist_event(event, normalized_context, persist_global_event) do
          :ok -> {:ok, event}
          {:error, reason} -> {:error, Adapter.normalize_persistence_error(reason)}
        end

      {:error, error} ->
        {:error, error}
    end
  end

  defp persist_event(event, context, persist_global_event)
       when is_function(persist_global_event, 2) do
    case persist_global_event.(event, context) do
      {:ok, _entry} -> :ok
      :ok -> :ok
      {:error, reason} -> {:error, reason}
      other -> {:error, other}
    end
  end
end

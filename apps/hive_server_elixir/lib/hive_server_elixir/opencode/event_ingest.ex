defmodule HiveServerElixir.Opencode.EventIngest do
  @moduledoc """
  Stream ingest entrypoint that normalizes and persists OpenCode stream items.
  """

  alias HiveServerElixir.Opencode.Adapter
  alias HiveServerElixir.Opencode.AgentEventLog
  alias HiveServerElixir.Opencode.EventEnvelope
  alias HiveServerElixir.Opencode.EventIngestContext

  @spec ingest_stream_item(term(), map(), keyword) ::
          {:ok, map()} | :skip | {:error, Adapter.normalized_error()}
  def ingest_stream_item(item, context, opts \\ []) when is_map(context) do
    normalized_context = EventIngestContext.normalize(context)

    persist_global_event =
      Keyword.get(opts, :persist_global_event, &AgentEventLog.append_global_event/2)

    case normalize_stream_item(item) do
      {:ok, event} ->
        case persist_event(event, normalized_context, persist_global_event) do
          :ok -> {:ok, event}
          {:error, reason} -> {:error, Adapter.normalize_persistence_error(reason)}
        end

      :skip ->
        :skip

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

  defp normalize_stream_item(%{"payload" => _payload} = event), do: {:ok, event}

  defp normalize_stream_item(event) when is_map(event) do
    if is_binary(EventEnvelope.type(event)) do
      {:ok, %{"payload" => event}}
    else
      {:error,
       Adapter.normalize_error(%{
         type: :unknown_stream_item,
         item: event
       })}
    end
  end

  defp normalize_stream_item({:error, %{type: _type} = error}), do: {:error, error}
  defp normalize_stream_item({:error, reason}), do: {:error, Adapter.normalize_error(reason)}
  defp normalize_stream_item(""), do: :skip
  defp normalize_stream_item(nil), do: :skip
  defp normalize_stream_item(_item), do: :skip
end

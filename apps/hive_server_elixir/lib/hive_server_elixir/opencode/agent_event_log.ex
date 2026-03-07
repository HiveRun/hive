defmodule HiveServerElixir.Opencode.AgentEventLog do
  @moduledoc """
  Append-only persistence helpers for OpenCode agent events.
  """

  import Ash.Expr
  require Ash.Query

  alias HiveServerElixir.Opencode
  alias HiveServerElixir.Opencode.AgentEvent
  alias HiveServerElixir.Repo

  @spec append(map) :: {:ok, AgentEvent.t()} | {:error, Ash.Error.t()}
  def append(attrs) when is_map(attrs) do
    Ash.create(AgentEvent, attrs, action: :append, domain: Opencode)
  end

  @spec append_global_event(map, map) :: {:ok, AgentEvent.t()} | {:error, Ash.Error.t()}
  def append_global_event(global_event, context_attrs)
      when is_map(global_event) and is_map(context_attrs) do
    context = normalize_context_attrs(context_attrs)

    session_id =
      case context.session_id do
        session_id when is_binary(session_id) and byte_size(session_id) > 0 ->
          session_id

        _ ->
          extract_session_id(global_event) || "global"
      end

    attrs =
      context
      |> Map.put(:session_id, session_id)
      |> Map.merge(%{event_type: extract_event_type(global_event), payload: global_event})

    case context.seq do
      seq when is_integer(seq) ->
        attrs
        |> Map.put(:seq, seq)
        |> append()

      _ ->
        append_with_reserved_seq(attrs)
    end
  end

  @spec list_session_timeline(String.t()) :: [AgentEvent.t()]
  def list_session_timeline(session_id) when is_binary(session_id) do
    AgentEvent
    |> Ash.Query.filter(expr(session_id == ^session_id))
    |> Ash.Query.sort(seq: :asc, inserted_at: :asc)
    |> Ash.read!(domain: Opencode)
  end

  defp extract_event_type(%{"payload" => %{"type" => type}}) when is_binary(type), do: type
  defp extract_event_type(%{"payload" => %{type: type}}) when is_binary(type), do: type
  defp extract_event_type(%{payload: %{"type" => type}}) when is_binary(type), do: type
  defp extract_event_type(%{payload: %{type: type}}) when is_binary(type), do: type
  defp extract_event_type(_), do: "unknown"

  defp normalize_context_attrs(context_attrs) do
    %{
      workspace_id: get_context_value(context_attrs, :workspace_id),
      cell_id: get_context_value(context_attrs, :cell_id),
      session_id: get_context_value(context_attrs, :session_id),
      seq: get_context_value(context_attrs, :seq)
    }
  end

  defp get_context_value(context_attrs, key) when is_atom(key) do
    Map.get(context_attrs, key) || Map.get(context_attrs, Atom.to_string(key))
  end

  defp append_with_reserved_seq(%{session_id: session_id} = attrs) do
    Repo.transaction(fn ->
      seq = reserve_next_seq!(session_id)

      case attrs |> Map.put(:seq, seq) |> append() do
        {:ok, entry} -> entry
        {:error, error} -> Repo.rollback(error)
      end
    end)
    |> case do
      {:ok, entry} -> {:ok, entry}
      {:error, error} -> {:error, error}
    end
  end

  defp reserve_next_seq!(session_id) do
    sql = """
    INSERT INTO agent_event_session_counters (session_id, last_seq, inserted_at, updated_at)
    VALUES (?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(session_id)
    DO UPDATE SET
      last_seq = agent_event_session_counters.last_seq + 1,
      updated_at = CURRENT_TIMESTAMP
    RETURNING last_seq
    """

    case Ecto.Adapters.SQL.query(Repo, sql, [session_id]) do
      {:ok, %{rows: [[seq]]}} when is_integer(seq) -> seq
      {:ok, %{rows: [[seq]]}} -> String.to_integer(to_string(seq))
      {:error, error} -> Repo.rollback(error)
    end
  end

  defp extract_session_id(%{"sessionID" => session_id}) when is_binary(session_id), do: session_id
  defp extract_session_id(%{"sessionId" => session_id}) when is_binary(session_id), do: session_id

  defp extract_session_id(%{"session_id" => session_id}) when is_binary(session_id),
    do: session_id

  defp extract_session_id(%{sessionID: session_id}) when is_binary(session_id), do: session_id
  defp extract_session_id(%{sessionId: session_id}) when is_binary(session_id), do: session_id
  defp extract_session_id(%{session_id: session_id}) when is_binary(session_id), do: session_id

  defp extract_session_id(map) when is_map(map) do
    map
    |> Map.values()
    |> Enum.find_value(&extract_session_id/1)
  end

  defp extract_session_id(list) when is_list(list) do
    Enum.find_value(list, &extract_session_id/1)
  end

  defp extract_session_id(_), do: nil
end

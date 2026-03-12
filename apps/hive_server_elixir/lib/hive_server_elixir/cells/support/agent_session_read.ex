defmodule HiveServerElixir.Cells.AgentSessionRead do
  @moduledoc false

  import Ash.Expr
  require Ash.Query

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.AgentSession
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.CellStatus
  alias HiveServerElixir.Cells.TemplateConfig
  alias HiveServerElixir.Opencode.AgentEvent
  alias HiveServerElixir.Opencode.AgentEventLog
  alias HiveServerElixir.Opencode.EventEnvelope

  @spec context_for_session(String.t()) :: {:ok, map()} | {:error, {atom(), String.t()}}
  def context_for_session(session_id) do
    with true <- is_binary(session_id) and byte_size(String.trim(session_id)) > 0 do
      case AgentSession.fetch_by_session_id(session_id) do
        %AgentSession{} = agent_session ->
          with {:ok, cell} <- get_cell(agent_session.cell_id) do
            {:ok, build_session_context(session_id, cell, agent_session)}
          end

        nil ->
          context_from_event(session_id)
      end
    else
      _value -> {:error, {:not_found, "Agent session not found"}}
    end
  end

  @spec payload_for_cell(String.t()) :: {:ok, map() | nil} | {:error, {atom(), String.t()}}
  def payload_for_cell(cell_id) when is_binary(cell_id) do
    with {:ok, %Cell{} = cell} <- get_cell(cell_id),
         {:ok, payload} <- payload_for_loaded_cell(cell) do
      {:ok, payload}
    else
      {:error, {:not_found, _message}} -> {:ok, nil}
      {:error, :not_found} -> {:ok, nil}
    end
  end

  @spec snapshot_for_session(String.t()) :: {:ok, map()} | {:error, {atom(), String.t()}}
  def snapshot_for_session(session_id) when is_binary(session_id) do
    with {:ok, context} <- context_for_session(session_id) do
      {:ok, snapshot_from_context(context)}
    end
  end

  @spec payload_from_context(map()) :: map()
  def payload_from_context(context) when is_map(context) do
    status = resolve_session_status(context)
    {start_mode, current_mode, mode_updated_at} = resolve_session_modes(context)

    agent_session = context.agent_session

    provider_id =
      session_provider_id(agent_session, context.timeline, context.cell.workspace_path)

    model_id = session_model_id(agent_session, context.timeline, context.cell.workspace_path)

    %{
      id: context.session_id,
      cellId: context.cell.id,
      templateId: context.cell.template_id,
      status: status,
      workspacePath: context.cell.workspace_path,
      createdAt: session_created_at(agent_session, context.timeline),
      updatedAt: session_updated_at(agent_session, context.cell, context.timeline)
    }
    |> maybe_put(:provider, provider_id)
    |> maybe_put(:modelId, model_id)
    |> maybe_put(:modelProviderId, provider_id)
    |> maybe_put(:startMode, start_mode)
    |> maybe_put(:currentMode, current_mode)
    |> maybe_put(:modeUpdatedAt, mode_updated_at)
  end

  defp payload_for_loaded_cell(cell) do
    agent_session = AgentSession.fetch_for_cell(cell.id)

    session_id =
      case agent_session do
        %AgentSession{} = value -> value.session_id
        nil -> fallback_session_id(cell)
      end

    if is_binary(session_id) and byte_size(String.trim(session_id)) > 0 do
      context = build_session_context(session_id, cell, agent_session)
      {:ok, payload_from_context(context)}
    else
      {:ok, nil}
    end
  end

  defp snapshot_from_context(context) do
    status = resolve_session_status(context)
    {start_mode, current_mode, mode_updated_at} = resolve_session_modes(context)

    %{
      status: status,
      startMode: start_mode,
      currentMode: current_mode,
      modeUpdatedAt: mode_updated_at
    }
  end

  defp context_from_event(session_id) do
    latest_event =
      AgentEvent
      |> Ash.Query.filter(expr(session_id == ^session_id))
      |> Ash.Query.sort(inserted_at: :desc, seq: :desc)
      |> Ash.read_one!(domain: HiveServerElixir.Opencode)

    case latest_event do
      %AgentEvent{} = event ->
        with {:ok, cell} <- get_cell(event.cell_id) do
          {:ok, build_session_context(session_id, cell, nil)}
        end

      nil ->
        {:error, {:not_found, "Agent session not found"}}
    end
  end

  defp build_session_context(session_id, cell, agent_session) do
    %{
      session_id: session_id,
      cell: cell,
      agent_session: agent_session,
      timeline: AgentEventLog.list_session_timeline(session_id)
    }
  end

  defp fallback_session_id(cell) do
    cond do
      is_binary(cell.opencode_session_id) and byte_size(String.trim(cell.opencode_session_id)) > 0 ->
        cell.opencode_session_id

      true ->
        latest_session_id_for_cell(cell.id)
    end
  end

  defp latest_session_id_for_cell(cell_id) do
    latest_event =
      AgentEvent
      |> Ash.Query.filter(expr(cell_id == ^cell_id and session_id != "global"))
      |> Ash.Query.sort(inserted_at: :desc, seq: :desc)
      |> Ash.read_one!(domain: HiveServerElixir.Opencode)

    case latest_event do
      %AgentEvent{session_id: session_id} when is_binary(session_id) -> session_id
      _other -> nil
    end
  end

  defp get_cell(cell_id) do
    case Ash.get(Cell, cell_id, domain: Cells) do
      {:ok, %Cell{} = cell} -> {:ok, cell}
      {:error, _error} -> {:error, {:not_found, "Cell not found"}}
    end
  end

  defp resolve_session_status(context) do
    timeline_status =
      context.timeline
      |> Enum.reverse()
      |> Enum.find_value(&event_status/1)

    case timeline_status do
      status when is_binary(status) -> status
      _other -> status_from_cell(context.cell.status)
    end
  end

  defp status_from_cell(status) do
    cond do
      CellStatus.error?(status) -> "error"
      CellStatus.ready?(status) -> "awaiting_input"
      CellStatus.stopped?(status) -> "completed"
      CellStatus.deleting?(status) -> "completed"
      true -> "starting"
    end
  end

  defp event_status(%AgentEvent{} = event) do
    event_type = EventEnvelope.type(event)
    properties = EventEnvelope.properties(event)

    cond do
      event_type == "session.error" ->
        "error"

      event_type == "session.idle" ->
        "awaiting_input"

      event_type in ["permission.asked", "permission.updated", "question.asked"] ->
        "awaiting_input"

      event_type == "session.status" and is_binary(EventEnvelope.get(properties, "status")) ->
        EventEnvelope.get(properties, "status")

      event_type in [
        "message.part.delta",
        "message.part.updated",
        "message.updated",
        "session.updated"
      ] ->
        "working"

      true ->
        nil
    end
  end

  defp resolve_session_modes(context) do
    mode_events =
      context.timeline
      |> Enum.flat_map(fn event ->
        mode = EventEnvelope.mode(event)

        if mode in ["plan", "build"] do
          [{mode, maybe_to_iso8601(event.inserted_at)}]
        else
          []
        end
      end)

    timeline_start_mode =
      case List.first(mode_events) do
        {mode, _time} -> mode
        _other -> nil
      end

    timeline_current_mode =
      case List.last(mode_events) do
        {mode, _time} -> mode
        _other -> nil
      end

    timeline_mode_updated_at =
      case List.last(mode_events) do
        {_mode, time} -> time
        _other -> nil
      end

    agent_session = context.agent_session

    start_mode = agent_session_mode(agent_session, :start_mode) || timeline_start_mode || "plan"

    current_mode =
      agent_session_mode(agent_session, :current_mode) || timeline_current_mode || start_mode

    mode_updated_at =
      maybe_to_iso8601(agent_session && agent_session.updated_at) || timeline_mode_updated_at

    {start_mode, current_mode, mode_updated_at}
  end

  defp agent_session_mode(%AgentSession{} = session, :start_mode),
    do: normalize_mode(session.start_mode)

  defp agent_session_mode(%AgentSession{} = session, :current_mode),
    do: normalize_mode(session.current_mode)

  defp agent_session_mode(_session, _field), do: nil

  defp normalize_mode("plan"), do: "plan"
  defp normalize_mode("build"), do: "build"
  defp normalize_mode(_mode), do: nil

  defp session_provider_id(%AgentSession{} = session, timeline, workspace_path) do
    session.model_provider_id || session_provider_id(nil, timeline, workspace_path)
  end

  defp session_provider_id(nil, timeline, workspace_path) do
    timeline_provider_id(timeline) || workspace_provider_id(workspace_path)
  end

  defp session_model_id(%AgentSession{} = session, timeline, workspace_path) do
    session.model_id || session_model_id(nil, timeline, workspace_path)
  end

  defp session_model_id(nil, timeline, workspace_path) do
    timeline_model_id(timeline) || workspace_model_id(workspace_path)
  end

  defp timeline_provider_id(timeline) do
    timeline
    |> Enum.reverse()
    |> Enum.find_value(&EventEnvelope.provider_id/1)
  end

  defp timeline_model_id(timeline) do
    timeline
    |> Enum.reverse()
    |> Enum.find_value(&EventEnvelope.model_id/1)
  end

  defp workspace_provider_id(workspace_path) do
    case TemplateConfig.load_agent_defaults(workspace_path) do
      %{provider_id: provider_id} -> provider_id
      _other -> nil
    end
  end

  defp workspace_model_id(workspace_path) do
    case TemplateConfig.load_agent_defaults(workspace_path) do
      %{model_id: model_id} -> model_id
      _other -> nil
    end
  end

  defp session_created_at(%AgentSession{} = session, _timeline),
    do: maybe_to_iso8601(session.inserted_at)

  defp session_created_at(nil, [%AgentEvent{} = first | _rest]),
    do: maybe_to_iso8601(first.inserted_at)

  defp session_created_at(nil, []), do: DateTime.utc_now() |> DateTime.to_iso8601()

  defp session_updated_at(%AgentSession{} = session, _cell, timeline) do
    maybe_to_iso8601(session.updated_at) || session_updated_at(nil, nil, timeline)
  end

  defp session_updated_at(nil, %Cell{} = cell, [%AgentEvent{} = latest | _rest]),
    do: maybe_to_iso8601(latest.inserted_at) || maybe_to_iso8601(cell.updated_at)

  defp session_updated_at(nil, %Cell{} = cell, []), do: maybe_to_iso8601(cell.updated_at)
  defp session_updated_at(nil, nil, []), do: DateTime.utc_now() |> DateTime.to_iso8601()

  defp session_updated_at(nil, nil, [%AgentEvent{} = latest | _rest]),
    do: maybe_to_iso8601(latest.inserted_at)

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, _key, ""), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)

  defp maybe_to_iso8601(%DateTime{} = value), do: DateTime.to_iso8601(value)
  defp maybe_to_iso8601(%NaiveDateTime{} = value), do: NaiveDateTime.to_iso8601(value)
  defp maybe_to_iso8601(value) when is_binary(value), do: value
  defp maybe_to_iso8601(_value), do: nil
end

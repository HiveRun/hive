defmodule HiveServerElixir.Agents.Support.SessionViewBuilder do
  @moduledoc false

  import Ash.Expr
  require Ash.Query

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.AgentSession
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.CellStatus
  alias HiveServerElixir.Cells.TerminalRuntime
  alias HiveServerElixir.Opencode.AgentEvent
  alias HiveServerElixir.Opencode.AgentEventLog
  alias HiveServerElixir.Opencode.Generated.Operations

  @opencode_config_filenames ["@opencode.json", "opencode.json"]

  @spec for_cell(String.t()) :: {:ok, map() | nil} | {:error, {atom(), String.t()}}
  def for_cell(cell_id) when is_binary(cell_id) do
    with {:ok, %Cell{} = cell} <- get_cell(cell_id),
         {:ok, payload} <- resolve_session_payload_for_cell(cell) do
      {:ok, payload}
    else
      {:error, {:not_found, _message}} -> {:ok, nil}
      {:error, :not_found} -> {:ok, nil}
    end
  end

  @spec messages_for_session(String.t()) ::
          {:ok, %{messages: [map()]}} | {:error, {atom(), String.t()}}
  def messages_for_session(session_id) when is_binary(session_id) do
    with {:ok, context} <- resolve_session_context(session_id),
         {:ok, messages} <- fetch_session_messages(context) do
      {:ok, %{messages: messages}}
    end
  end

  @spec event_snapshot_for_session(String.t()) :: {:ok, map()} | {:error, {atom(), String.t()}}
  def event_snapshot_for_session(session_id) when is_binary(session_id) do
    with {:ok, context} <- resolve_session_context(session_id) do
      {:ok, build_event_snapshot(context)}
    end
  end

  @spec set_session_mode(String.t(), String.t()) :: {:ok, map()} | {:error, {atom(), String.t()}}
  def set_session_mode(session_id, mode) when is_binary(session_id) and is_binary(mode) do
    normalized_mode = normalize_mode(mode)

    if normalized_mode in ["plan", "build"] do
      with {:ok, context} <- resolve_session_context(session_id),
           {:ok, %AgentSession{} = agent_session} <- resolve_persisted_session(context),
           {:ok, updated_session} <-
             Ash.update(agent_session, %{current_mode: normalized_mode}, domain: Cells) do
        updated_context = %{context | agent_session: updated_session}
        {:ok, serialize_agent_session(updated_context)}
      else
        {:error, {_, _} = reason} -> {:error, reason}
        {:error, _error} -> {:error, {:bad_request, "Failed to update session mode"}}
      end
    else
      {:error, {:bad_request, "mode must be either 'plan' or 'build'"}}
    end
  end

  @spec resolve_session_context(String.t()) :: {:ok, map()} | {:error, {atom(), String.t()}}
  def resolve_session_context(session_id) do
    with true <- is_binary(session_id) and byte_size(String.trim(session_id)) > 0 do
      case maybe_get_session_by_session_id(session_id) do
        %AgentSession{} = agent_session ->
          with {:ok, cell} <- get_cell(agent_session.cell_id) do
            {:ok, build_session_context(session_id, cell, agent_session)}
          end

        nil ->
          resolve_session_context_from_event(session_id)
      end
    else
      _value ->
        {:error, {:not_found, "Agent session not found"}}
    end
  end

  def maybe_existing_atom(key) do
    String.to_existing_atom(key)
  rescue
    ArgumentError -> nil
  end

  defp maybe_get_session_by_session_id(session_id) do
    session =
      AgentSession
      |> Ash.Query.filter(expr(session_id == ^session_id))
      |> Ash.read_one!(domain: Cells)

    case session do
      %AgentSession{} = value -> value
      nil -> nil
    end
  end

  defp maybe_get_session_by_cell_id(cell_id) do
    session =
      AgentSession
      |> Ash.Query.filter(expr(cell_id == ^cell_id))
      |> Ash.read_one!(domain: Cells)

    case session do
      %AgentSession{} = value -> value
      nil -> nil
    end
  end

  defp resolve_session_context_from_event(session_id) do
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

  defp resolve_session_payload_for_cell(cell) do
    agent_session = maybe_get_session_by_cell_id(cell.id)

    session_id =
      case agent_session do
        %AgentSession{} = value -> value.session_id
        nil -> resolve_fallback_session_id(cell)
      end

    if is_binary(session_id) and byte_size(String.trim(session_id)) > 0 do
      context = build_session_context(session_id, cell, agent_session)
      {:ok, serialize_agent_session(context)}
    else
      {:ok, nil}
    end
  end

  defp resolve_fallback_session_id(cell) do
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

  defp fetch_session_messages(context) do
    opts =
      [directory: context.cell.workspace_path, client: opencode_client()] ++
        opencode_client_opts()

    case Operations.session_messages(context.session_id, opts) do
      {:ok, payload} when is_list(payload) ->
        {:ok,
         Enum.with_index(payload)
         |> Enum.map(fn {entry, index} -> serialize_message(entry, context, index) end)}

      {:error, %{status: 404}} ->
        {:ok, fallback_messages_from_terminal(context)}

      {:error, %{status: _status}} ->
        {:ok, fallback_messages_from_terminal(context)}

      {:error, _reason} ->
        {:ok, fallback_messages_from_terminal(context)}

      :error ->
        {:ok, fallback_messages_from_terminal(context)}
    end
  end

  defp fallback_messages_from_terminal(context) do
    output =
      context.cell.id
      |> TerminalRuntime.read_chat_output()
      |> Enum.join("")
      |> String.trim()

    if output == "" do
      []
    else
      timestamp = DateTime.utc_now() |> DateTime.truncate(:second) |> DateTime.to_iso8601()

      [
        %{
          id: "fallback-user-#{context.cell.id}",
          sessionId: context.session_id,
          role: "user",
          content: output,
          state: "completed",
          createdAt: timestamp,
          parts: []
        },
        %{
          id: "fallback-assistant-#{context.cell.id}",
          sessionId: context.session_id,
          role: "assistant",
          content: output,
          state: "completed",
          createdAt: timestamp,
          parts: []
        }
      ]
    end
  end

  defp serialize_message(entry, context, index) do
    info = read_key(entry, "info") || %{}
    parts = normalize_parts(read_key(entry, "parts"))
    role = normalize_role(read_key(info, "role"))
    content = message_content(parts)
    error = read_key(info, "error")

    message = %{
      id: read_key(info, "id") || "message-#{index + 1}",
      sessionId: read_key(info, "sessionID") || context.session_id,
      role: role,
      content: content,
      state: message_state(role, info, content),
      createdAt: message_created_at(info),
      parts: parts
    }

    message
    |> maybe_put(:parentId, read_key(info, "parentID"))
    |> maybe_put(:errorName, read_key(error, "name"))
    |> maybe_put(:errorMessage, read_key(error, "message"))
  end

  defp normalize_parts(parts) when is_list(parts), do: parts
  defp normalize_parts(_parts), do: []

  defp normalize_role("assistant"), do: "assistant"
  defp normalize_role("system"), do: "system"
  defp normalize_role(_other), do: "user"

  defp message_content(parts) do
    text =
      parts
      |> Enum.flat_map(fn part ->
        type = read_key(part, "type")
        text = read_key(part, "text")

        if type in ["text", "reasoning"] and is_binary(text) do
          [text]
        else
          []
        end
      end)
      |> Enum.join("")
      |> String.trim()

    if text == "", do: nil, else: text
  end

  defp message_state("user", _info, _content), do: "completed"

  defp message_state(_role, info, content) do
    cond do
      is_map(read_key(info, "error")) -> "error"
      is_number(read_key(read_key(info, "time") || %{}, "completed")) -> "completed"
      is_binary(read_key(info, "finish")) -> "completed"
      is_binary(content) and byte_size(content) > 0 -> "completed"
      true -> "streaming"
    end
  end

  defp message_created_at(info) do
    time = read_key(info, "time") || %{}
    created = read_key(time, "created")

    case created do
      value when is_integer(value) or is_float(value) -> unix_to_iso8601(value)
      value when is_binary(value) -> value
      _other -> DateTime.utc_now() |> DateTime.truncate(:second) |> DateTime.to_iso8601()
    end
  end

  defp build_event_snapshot(context) do
    status = resolve_session_status(context)
    {start_mode, current_mode, mode_updated_at} = resolve_session_modes(context)

    %{
      status: status,
      startMode: start_mode,
      currentMode: current_mode,
      modeUpdatedAt: mode_updated_at
    }
  end

  defp serialize_agent_session(context) do
    status = resolve_session_status(context)
    {start_mode, current_mode, mode_updated_at} = resolve_session_modes(context)

    agent_session = context.agent_session

    provider_id =
      session_provider_id(agent_session, context.timeline, context.cell.workspace_path)

    model_id = session_model_id(agent_session, context.timeline, context.cell.workspace_path)

    payload = %{
      id: context.session_id,
      cellId: context.cell.id,
      templateId: context.cell.template_id,
      status: status,
      workspacePath: context.cell.workspace_path,
      createdAt: session_created_at(agent_session, context.timeline),
      updatedAt: session_updated_at(agent_session, context.cell, context.timeline)
    }

    payload
    |> maybe_put(:provider, provider_id)
    |> maybe_put(:modelId, model_id)
    |> maybe_put(:modelProviderId, provider_id)
    |> maybe_put(:startMode, start_mode)
    |> maybe_put(:currentMode, current_mode)
    |> maybe_put(:modeUpdatedAt, mode_updated_at)
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
    payload = event_payload(event)
    event_type = read_key(payload, "type") || event.event_type
    properties = read_key(payload, "properties") || %{}

    cond do
      event_type == "session.error" ->
        "error"

      event_type == "session.idle" ->
        "awaiting_input"

      event_type in ["permission.asked", "permission.updated", "question.asked"] ->
        "awaiting_input"

      event_type == "session.status" and is_binary(read_key(properties, "status")) ->
        read_key(properties, "status")

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
        mode = event_mode(event)

        if mode in ["plan", "build"] do
          [{mode, maybe_to_iso8601(event.inserted_at)}]
        else
          []
        end
      end)

    timeline_start_mode =
      mode_events
      |> List.first()
      |> case do
        {mode, _time} -> mode
        _other -> nil
      end

    timeline_current_mode =
      mode_events
      |> List.last()
      |> case do
        {mode, _time} -> mode
        _other -> nil
      end

    timeline_mode_updated_at =
      mode_events
      |> List.last()
      |> case do
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

  defp event_mode(%AgentEvent{} = event) do
    payload = event_payload(event)
    properties = read_key(payload, "properties") || %{}

    candidate =
      read_key(properties, "agent") ||
        read_key(properties, "currentMode") ||
        read_key(properties, "startMode")

    if candidate in ["plan", "build"], do: candidate, else: nil
  end

  defp event_payload(%AgentEvent{} = event) do
    read_key(event.payload, "payload") || event.payload || %{}
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
    |> Enum.find_value(fn event ->
      payload = event_payload(event)
      properties = read_key(payload, "properties") || %{}
      model = read_key(properties, "model") || %{}

      read_key(model, "providerID") ||
        read_key(model, "providerId") ||
        read_key(properties, "providerID") ||
        read_key(properties, "providerId")
    end)
  end

  defp timeline_model_id(timeline) do
    timeline
    |> Enum.reverse()
    |> Enum.find_value(fn event ->
      payload = event_payload(event)
      properties = read_key(payload, "properties") || %{}
      model = read_key(properties, "model") || %{}

      read_key(model, "modelID") ||
        read_key(model, "modelId") ||
        read_key(properties, "modelID") ||
        read_key(properties, "modelId")
    end)
  end

  defp workspace_provider_id(workspace_path) do
    case load_workspace_model_defaults(workspace_path) do
      {provider_id, _model_id} -> provider_id
      _other -> nil
    end
  end

  defp workspace_model_id(workspace_path) do
    case load_workspace_model_defaults(workspace_path) do
      {_provider_id, model_id} -> model_id
      _other -> nil
    end
  end

  defp load_workspace_model_defaults(workspace_path) when is_binary(workspace_path) do
    @opencode_config_filenames
    |> Enum.map(&Path.join(workspace_path, &1))
    |> Enum.find_value(fn config_path ->
      with {:ok, contents} <- File.read(config_path),
           {:ok, decoded} <- Jason.decode(contents),
           model when is_binary(model) <- Map.get(decoded, "model") do
        parse_workspace_model(model)
      else
        _other -> nil
      end
    end)
  end

  defp load_workspace_model_defaults(_workspace_path), do: nil

  defp parse_workspace_model(model) when is_binary(model) do
    case model |> String.trim() |> String.split("/", parts: 2) do
      [provider_id, model_id] when provider_id != "" and model_id != "" -> {provider_id, model_id}
      [model_id] when model_id != "" -> {nil, model_id}
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

  defp unix_to_iso8601(value) when is_integer(value) do
    value
    |> DateTime.from_unix(:millisecond)
    |> case do
      {:ok, datetime} -> DateTime.to_iso8601(datetime)
      _other -> DateTime.utc_now() |> DateTime.to_iso8601()
    end
  end

  defp unix_to_iso8601(value) when is_float(value), do: value |> round() |> unix_to_iso8601()

  defp read_key(value, key) when is_map(value) and is_binary(key) do
    case Map.fetch(value, key) do
      {:ok, found} ->
        found

      :error ->
        case maybe_existing_atom(key) do
          atom when is_atom(atom) -> Map.get(value, atom)
          _other -> nil
        end
    end
  end

  defp read_key(_value, _key), do: nil

  defp resolve_persisted_session(%{agent_session: %AgentSession{} = session}), do: {:ok, session}
  defp resolve_persisted_session(_context), do: {:error, {:not_found, "Agent session not found"}}

  defp opencode_client do
    Application.get_env(:hive_server_elixir, :opencode_client, HiveServerElixir.Opencode.Client)
  end

  defp opencode_client_opts do
    case Application.get_env(:hive_server_elixir, :opencode_client_opts, []) do
      opts when is_list(opts) -> opts
      _value -> []
    end
  end
end

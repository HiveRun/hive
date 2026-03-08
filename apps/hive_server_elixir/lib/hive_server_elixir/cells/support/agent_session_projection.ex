defmodule HiveServerElixir.Cells.AgentSessionProjection do
  @moduledoc false

  import Ash.Expr
  require Ash.Query

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.AgentSession
  alias HiveServerElixir.Cells.Cell

  @healthy_session_events [
    "message.part.delta",
    "message.part.updated",
    "message.updated",
    "permission.asked",
    "permission.updated",
    "question.asked",
    "session.idle",
    "session.status",
    "session.updated"
  ]

  @spec ensure_resume_projection(Cell.t()) :: :ok
  def ensure_resume_projection(%Cell{} = cell) do
    with {:ok, %AgentSession{} = session} <- ensure_session(cell, cell.opencode_session_id, %{}),
         {:ok, _updated_session} <-
           sync_runtime_details(session, %{
             resume_on_startup: true
           }) do
      :ok
    else
      _other -> :ok
    end
  end

  @spec project_opencode_event(map(), map()) :: :ok
  def project_opencode_event(context, global_event)
      when is_map(context) and is_map(global_event) do
    with {:ok, %Cell{} = cell} <- get_cell(cell_id_from_context(context)),
         session_id when is_binary(session_id) <- session_id_from_event(context, global_event),
         {:ok, %AgentSession{} = session} <- ensure_session(cell, session_id, global_event),
         {:ok, %AgentSession{} = session} <-
           sync_runtime_details(session, runtime_detail_attrs(global_event)),
         {:ok, %AgentSession{} = session} <- maybe_set_mode(session, global_event),
         {:ok, %AgentSession{}} <- maybe_record_error(session, global_event) do
      :ok
    else
      _other -> :ok
    end
  end

  defp ensure_session(%Cell{} = cell, session_id, global_event) when is_binary(session_id) do
    case session_by_session_id(session_id) || session_by_cell_id(cell.id) do
      %AgentSession{} = session ->
        {:ok, session}

      nil ->
        begin_session(cell, session_id, global_event)
    end
  end

  defp ensure_session(%Cell{} = _cell, _session_id, _global_event),
    do: {:error, :session_not_found}

  defp begin_session(%Cell{} = cell, session_id, global_event) do
    attrs =
      %{
        cell_id: cell.id,
        session_id: session_id,
        resume_on_startup: true
      }
      |> maybe_put(:start_mode, event_mode(global_event))
      |> maybe_put(:current_mode, event_mode(global_event))
      |> maybe_put(:model_id, event_model_id(global_event))
      |> maybe_put(:model_provider_id, event_provider_id(global_event))
      |> maybe_put(:last_error, event_error_message(global_event))

    Ash.create(AgentSession, attrs, action: :begin_session, domain: Cells)
  end

  defp sync_runtime_details(%AgentSession{} = session, attrs) when is_map(attrs) do
    changed_attrs =
      attrs
      |> Enum.reject(fn
        {_key, nil} -> true
        {:model_id, value} -> value == session.model_id
        {:model_provider_id, value} -> value == session.model_provider_id
        {:resume_on_startup, value} -> value == session.resume_on_startup
      end)
      |> Map.new()

    if map_size(changed_attrs) == 0 do
      {:ok, session}
    else
      Ash.update(session, changed_attrs, action: :sync_runtime_details, domain: Cells)
    end
  end

  defp maybe_set_mode(%AgentSession{} = session, global_event) do
    mode = event_mode(global_event)

    cond do
      not is_binary(mode) ->
        {:ok, session}

      mode == session.current_mode ->
        {:ok, session}

      true ->
        Ash.update(session, %{mode: mode}, action: :set_mode, domain: Cells)
    end
  end

  defp maybe_record_error(%AgentSession{} = session, global_event) do
    event_type = event_type(global_event)
    error_message = event_error_message(global_event)

    cond do
      is_binary(error_message) and error_message != session.last_error ->
        Ash.update(session, %{last_error: error_message}, action: :record_error, domain: Cells)

      is_binary(error_message) ->
        {:ok, session}

      event_type in @healthy_session_events and not is_nil(session.last_error) ->
        Ash.update(session, %{last_error: nil}, action: :record_error, domain: Cells)

      true ->
        {:ok, session}
    end
  end

  defp runtime_detail_attrs(global_event) do
    %{
      model_id: event_model_id(global_event),
      model_provider_id: event_provider_id(global_event),
      resume_on_startup: true
    }
  end

  defp get_cell(cell_id) when is_binary(cell_id), do: Ash.get(Cell, cell_id, domain: Cells)
  defp get_cell(_cell_id), do: {:error, :cell_not_found}

  defp session_by_session_id(session_id) do
    AgentSession
    |> Ash.Query.filter(expr(session_id == ^session_id))
    |> Ash.read_one!(domain: Cells)
  end

  defp session_by_cell_id(cell_id) do
    AgentSession
    |> Ash.Query.filter(expr(cell_id == ^cell_id))
    |> Ash.read_one!(domain: Cells)
  end

  defp cell_id_from_context(context) when is_map(context) do
    map_value(context, "cell_id")
  end

  defp session_id_from_event(context, global_event) do
    event_session_id(global_event) || map_value(context, "session_id")
  end

  defp event_session_id(global_event) do
    properties = event_properties(global_event)

    map_value(properties, "sessionID") ||
      map_value(properties, "sessionId") ||
      map_value(properties, "session_id") ||
      map_value(global_event, "sessionID") ||
      map_value(global_event, "sessionId") ||
      map_value(global_event, "session_id")
  end

  defp event_mode(global_event) do
    properties = event_properties(global_event)

    case map_value(properties, "agent") || map_value(properties, "currentMode") ||
           map_value(properties, "startMode") do
      "plan" -> "plan"
      "build" -> "build"
      _other -> nil
    end
  end

  defp event_model_id(global_event) do
    properties = event_properties(global_event)
    model = map_value(properties, "model") || %{}

    map_value(model, "modelID") ||
      map_value(model, "modelId") ||
      map_value(properties, "modelID") ||
      map_value(properties, "modelId")
  end

  defp event_provider_id(global_event) do
    properties = event_properties(global_event)
    model = map_value(properties, "model") || %{}

    map_value(model, "providerID") ||
      map_value(model, "providerId") ||
      map_value(properties, "providerID") ||
      map_value(properties, "providerId")
  end

  defp event_error_message(global_event) do
    if event_type(global_event) == "session.error" do
      properties = event_properties(global_event)
      nested_error = map_value(properties, "error")

      cond do
        is_binary(map_value(properties, "message")) ->
          map_value(properties, "message")

        is_map(nested_error) and is_binary(map_value(nested_error, "message")) ->
          map_value(nested_error, "message")

        true ->
          "OpenCode session error"
      end
    end
  end

  defp event_type(global_event) do
    global_event
    |> map_value("payload")
    |> map_value("type")
  end

  defp event_properties(global_event) do
    global_event
    |> map_value("payload")
    |> map_value("properties") || %{}
  end

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, _key, ""), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)

  defp map_value(map, key) when is_map(map) and is_binary(key) do
    Map.get(map, key) || Map.get(map, key_to_existing_atom(key))
  rescue
    ArgumentError ->
      Map.get(map, key)
  end

  defp map_value(_map, _key), do: nil

  defp key_to_existing_atom(key), do: String.to_existing_atom(key)
end

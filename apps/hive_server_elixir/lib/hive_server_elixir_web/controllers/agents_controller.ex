defmodule HiveServerElixirWeb.AgentsController do
  use HiveServerElixirWeb, :controller

  alias HiveServerElixir.Agents

  @agent_events_heartbeat_ms 2_000

  def models(conn, params) do
    workspace_id = resolve_workspace_id(params, conn)

    case Agents.provider_payload_for_workspace(workspace_id) do
      {:ok, payload} ->
        json(conn, payload)

      {:error, {status, message}} ->
        conn
        |> put_status(status)
        |> json(Agents.empty_provider_payload(message))
    end
  end

  def session_models(conn, %{"id" => session_id}) do
    case Agents.provider_payload_for_session(session_id) do
      {:ok, payload} ->
        json(conn, payload)

      {:error, {status, message}} ->
        conn
        |> put_status(status)
        |> json(Agents.empty_provider_payload(message))
    end
  end

  def session_by_cell(conn, %{"cellId" => cell_id}) do
    {:ok, session} = Agents.session_payload_for_cell(cell_id)
    json(conn, %{session: session})
  end

  def session_messages(conn, %{"id" => session_id}) do
    case Agents.messages_payload_for_session(session_id) do
      {:ok, payload} ->
        json(conn, payload)

      {:error, {status, message}} ->
        conn
        |> put_status(status)
        |> json(%{message: message})
    end
  end

  def update_session_mode(conn, %{"id" => session_id, "mode" => mode}) do
    case Agents.set_session_mode(session_id, mode) do
      {:ok, payload} ->
        json(conn, payload)

      {:error, {status, message}} ->
        conn
        |> put_status(status)
        |> json(%{message: message})
    end
  end

  def session_events(conn, %{"id" => session_id} = params) do
    case Agents.event_snapshot_for_session(session_id) do
      {:ok, snapshot} ->
        stream_conn =
          conn
          |> put_resp_content_type("text/event-stream")
          |> put_resp_header("cache-control", "no-cache")
          |> put_resp_header("connection", "keep-alive")
          |> send_chunked(200)

        with {:ok, stream_conn} <- send_sse(stream_conn, "status", %{status: snapshot.status}),
             {:ok, stream_conn} <- maybe_send_mode(stream_conn, snapshot),
             {:ok, stream_conn} <- maybe_send_input_required(stream_conn, nil, snapshot) do
          if initial_only?(params) do
            stream_conn
          else
            stream_session_events(stream_conn, session_id, snapshot)
          end
        else
          {:error, _reason} -> stream_conn
        end

      {:error, {status, message}} ->
        conn
        |> put_status(status)
        |> json(%{message: message})
    end
  end

  defp resolve_workspace_id(params, conn) do
    query_workspace_id = Map.get(params, "workspaceId")

    if is_binary(query_workspace_id) and byte_size(String.trim(query_workspace_id)) > 0 do
      String.trim(query_workspace_id)
    else
      case Plug.Conn.get_req_header(conn, "x-workspace-id") do
        [workspace_id | _rest] ->
          trimmed_workspace_id = String.trim(workspace_id)
          if byte_size(trimmed_workspace_id) > 0, do: trimmed_workspace_id, else: nil

        _other ->
          nil
      end
    end
  end

  defp stream_session_events(conn, session_id, previous_snapshot) do
    receive do
    after
      @agent_events_heartbeat_ms ->
        case Agents.event_snapshot_for_session(session_id) do
          {:ok, snapshot} ->
            with {:ok, next_conn} <- maybe_send_status(conn, previous_snapshot, snapshot),
                 {:ok, next_conn} <- maybe_send_mode(next_conn, previous_snapshot, snapshot),
                 {:ok, next_conn} <-
                   maybe_send_input_required(next_conn, previous_snapshot, snapshot),
                 {:ok, next_conn} <-
                   send_sse(next_conn, "heartbeat", %{timestamp: System.system_time(:millisecond)}) do
              stream_session_events(next_conn, session_id, snapshot)
            else
              {:error, _reason} -> conn
            end

          {:error, {_status, message}} ->
            case send_sse(conn, "status", %{status: "error", error: message}) do
              {:ok, next_conn} -> next_conn
              {:error, _reason} -> conn
            end
        end
    end
  end

  defp maybe_send_status(conn, previous_snapshot, snapshot) do
    if previous_snapshot.status != snapshot.status do
      send_sse(conn, "status", %{status: snapshot.status})
    else
      {:ok, conn}
    end
  end

  defp maybe_send_mode(conn, snapshot), do: maybe_send_mode(conn, nil, snapshot)

  defp maybe_send_mode(conn, previous_snapshot, snapshot) do
    changed? =
      is_nil(previous_snapshot) or
        previous_snapshot.startMode != snapshot.startMode or
        previous_snapshot.currentMode != snapshot.currentMode or
        previous_snapshot.modeUpdatedAt != snapshot.modeUpdatedAt

    if changed? and is_binary(snapshot.startMode) and is_binary(snapshot.currentMode) do
      payload =
        %{startMode: snapshot.startMode, currentMode: snapshot.currentMode}
        |> maybe_put_mode_updated_at(snapshot.modeUpdatedAt)

      send_sse(conn, "mode", payload)
    else
      {:ok, conn}
    end
  end

  defp maybe_send_input_required(conn, previous_snapshot, snapshot) do
    became_awaiting_input =
      snapshot.status == "awaiting_input" and
        (is_nil(previous_snapshot) or previous_snapshot.status != "awaiting_input")

    if became_awaiting_input do
      send_sse(conn, "input_required", %{kind: "question", title: "Input required"})
    else
      {:ok, conn}
    end
  end

  defp maybe_put_mode_updated_at(payload, value) when is_binary(value),
    do: Map.put(payload, :modeUpdatedAt, value)

  defp maybe_put_mode_updated_at(payload, _value), do: payload

  defp initial_only?(params), do: Map.get(params, "initialOnly") in ["true", "1"]

  defp send_sse(conn, event, data) do
    encoded = Jason.encode!(data)

    conn
    |> chunk("event: #{event}\ndata: #{encoded}\n\n")
    |> case do
      {:ok, next_conn} -> {:ok, next_conn}
      {:error, reason} -> {:error, reason}
    end
  end
end

defmodule HiveServerElixir.Agents.Support.SessionViewBuilder do
  @moduledoc false

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.AgentSession
  alias HiveServerElixir.Cells.AgentSessionRead
  alias HiveServerElixir.Cells.TerminalRuntime
  alias HiveServerElixir.Opencode.Generated.Operations

  @spec for_cell(String.t()) :: {:ok, map() | nil} | {:error, {atom(), String.t()}}
  def for_cell(cell_id) when is_binary(cell_id) do
    AgentSessionRead.payload_for_cell(cell_id)
  end

  @spec messages_for_session(String.t()) ::
          {:ok, %{messages: [map()]}} | {:error, {atom(), String.t()}}
  def messages_for_session(session_id) when is_binary(session_id) do
    with {:ok, context} <- AgentSessionRead.context_for_session(session_id),
         {:ok, messages} <- fetch_session_messages(context) do
      {:ok, %{messages: messages}}
    end
  end

  @spec event_snapshot_for_session(String.t()) :: {:ok, map()} | {:error, {atom(), String.t()}}
  def event_snapshot_for_session(session_id) when is_binary(session_id) do
    AgentSessionRead.snapshot_for_session(session_id)
  end

  @spec set_session_mode(String.t(), String.t()) :: {:ok, map()} | {:error, {atom(), String.t()}}
  def set_session_mode(session_id, mode) when is_binary(session_id) and is_binary(mode) do
    normalized_mode = normalize_mode(mode)

    if normalized_mode in ["plan", "build"] do
      with {:ok, context} <- AgentSessionRead.context_for_session(session_id),
           {:ok, %AgentSession{} = agent_session} <- resolve_persisted_session(context),
           {:ok, updated_session} <-
             Ash.update(agent_session, %{mode: normalized_mode}, action: :set_mode, domain: Cells) do
        updated_context = %{context | agent_session: updated_session}
        {:ok, AgentSessionRead.payload_from_context(updated_context)}
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
    AgentSessionRead.context_for_session(session_id)
  end

  def maybe_existing_atom(key) do
    AgentSessionRead.maybe_existing_atom(key)
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

  defp normalize_mode("plan"), do: "plan"
  defp normalize_mode("build"), do: "build"
  defp normalize_mode(_mode), do: nil

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, _key, ""), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)

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

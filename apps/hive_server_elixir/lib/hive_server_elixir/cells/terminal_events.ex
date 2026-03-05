defmodule HiveServerElixir.Cells.TerminalEvents do
  @moduledoc false

  alias HiveServerElixir.Cells.Events
  alias HiveServerElixir.Cells.TerminalRuntime

  @spec on_cell_started(map) :: :ok
  def on_cell_started(context) when is_map(context) do
    case cell_id_from_context(context) do
      nil ->
        :ok

      cell_id ->
        _ = TerminalRuntime.ensure_setup_session(cell_id)
        _ = TerminalRuntime.ensure_chat_session(cell_id)
        :ok = TerminalRuntime.append_setup_output(cell_id, "[hive] provisioning started\n")
        Events.publish_setup_terminal_data(cell_id, "[hive] provisioning started\n")
    end
  end

  @spec on_cell_ready(map) :: :ok
  def on_cell_ready(context) when is_map(context) do
    case cell_id_from_context(context) do
      nil ->
        :ok

      cell_id ->
        :ok = TerminalRuntime.append_setup_output(cell_id, "[hive] provisioning completed\n")
        :ok = Events.publish_setup_terminal_data(cell_id, "[hive] provisioning completed\n")
        Events.publish_setup_terminal_exit(cell_id, 0, nil)
    end
  end

  @spec on_cell_error(map, String.t()) :: :ok
  def on_cell_error(context, message) when is_map(context) and is_binary(message) do
    case cell_id_from_context(context) do
      nil ->
        :ok

      cell_id ->
        :ok =
          TerminalRuntime.append_setup_output(cell_id, "[hive] provisioning failed: #{message}\n")

        :ok = Events.publish_setup_terminal_error(cell_id, message)
        Events.publish_setup_terminal_exit(cell_id, 1, nil)
    end
  end

  @spec on_cell_stopped(map) :: :ok
  def on_cell_stopped(context) when is_map(context) do
    case cell_id_from_context(context) do
      nil ->
        :ok

      cell_id ->
        _ = Events.publish_setup_terminal_exit(cell_id, 0, nil)
        _ = Events.publish_chat_terminal_exit(cell_id, 0, nil)
        TerminalRuntime.clear_cell(cell_id)
    end
  end

  @spec project_opencode_event(map, map) :: :ok
  def project_opencode_event(context, global_event)
      when is_map(context) and is_map(global_event) do
    case cell_id_from_context(context) do
      nil ->
        :ok

      cell_id ->
        payload = map_value(global_event, "payload") || %{}
        event_type = map_value(payload, "type")
        properties = map_value(payload, "properties") || %{}

        case event_type do
          "message.part.delta" ->
            maybe_emit_chat_delta(cell_id, properties)

          "message.part.updated" ->
            maybe_emit_chat_part(cell_id, properties)

          "session.error" ->
            message = extract_error_message(properties)
            Events.publish_chat_terminal_error(cell_id, message)

          "pty.exited" ->
            exit_code = map_value(properties, "exitCode")
            exit_code = if(is_number(exit_code), do: trunc(exit_code), else: nil)
            Events.publish_chat_terminal_exit(cell_id, exit_code, nil)

          _other ->
            :ok
        end
    end
  end

  defp maybe_emit_chat_delta(cell_id, properties) do
    delta = map_value(properties, "delta")
    field = map_value(properties, "field")

    if is_binary(delta) and (is_nil(field) or field in ["text", "delta"]) do
      emit_chat_chunk(cell_id, delta)
    else
      :ok
    end
  end

  defp maybe_emit_chat_part(cell_id, properties) do
    part = map_value(properties, "part")
    part_type = map_value(part || %{}, "type")
    part_text = map_value(part || %{}, "text")

    if is_binary(part_text) and part_type in ["text", "reasoning"] do
      emit_chat_chunk(cell_id, part_text)
    else
      :ok
    end
  end

  defp emit_chat_chunk(cell_id, chunk) do
    _ = TerminalRuntime.ensure_chat_session(cell_id)
    :ok = TerminalRuntime.append_chat_output(cell_id, chunk)
    Events.publish_chat_terminal_data(cell_id, chunk)
  end

  defp extract_error_message(properties) when is_map(properties) do
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

  defp extract_error_message(_properties), do: "OpenCode session error"

  defp cell_id_from_context(context) when is_map(context) do
    map_value(context, "cell_id")
  end

  defp map_value(map, key) when is_map(map) and is_binary(key) do
    Map.get(map, key) || Map.get(map, String.to_existing_atom(key))
  rescue
    ArgumentError ->
      Map.get(map, key)
  end

  defp map_value(_map, _key), do: nil
end

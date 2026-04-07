defmodule HiveServerElixir.Cells.Terminals.SetupRunner do
  @moduledoc false

  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Events
  alias HiveServerElixir.Cells.TerminalRuntime

  @setup_command_timeout_ms 600_000

  @spec run(Cell.t(), map()) :: :ok | {:error, String.t()}
  def run(%Cell{} = cell, template) when is_map(template) do
    commands = Map.get(template, :setup, [])

    if commands == [] do
      :ok
    else
      with {:ok, _session} <- TerminalRuntime.ensure_setup_session(cell),
           :ok <-
             TerminalRuntime.append_setup_output(
               cell.id,
               "[setup] Starting template setup for #{template.id}\n"
             ) do
        Enum.reduce_while(commands, :ok, fn command, :ok ->
          case run_command(cell, Map.get(template, :env, %{}), command) do
            :ok -> {:cont, :ok}
            {:error, message} -> {:halt, {:error, message}}
          end
        end)
      end
    end
  end

  defp run_command(%Cell{} = cell, env, command) do
    marker = "__HIVE_SETUP_EXIT_#{Ash.UUID.generate()}__"
    wrapped = wrap_command(command, marker, env)
    timeout_ms = setup_command_timeout_ms()

    :ok = TerminalRuntime.append_setup_output(cell.id, "[setup] Running: #{command}\n")
    :ok = Events.subscribe_setup_terminal(cell.id)

    with :ok <- TerminalRuntime.write_setup_input(cell.id, wrapped),
         {:ok, exit_code} <- wait_for_marker(cell.id, marker, timeout_ms) do
      if exit_code == 0 do
        :ok = TerminalRuntime.append_setup_output(cell.id, "[setup] Completed: #{command}\n")
        :ok
      else
        :ok =
          TerminalRuntime.append_setup_output(
            cell.id,
            "[setup] Failed: #{command} (exit #{exit_code})\n"
          )

        {:error,
         "Template setup command failed with exit code #{exit_code}: #{command}\n\n#{summarize_setup_output(TerminalRuntime.read_setup_output(cell.id))}"}
      end
    else
      {:error, :timeout} ->
        captured_output = TerminalRuntime.read_setup_output(cell.id)
        _ = TerminalRuntime.restart_setup_session(cell.id)

        {:error,
         "Template setup command timed out after #{div(timeout_ms, 1_000)} seconds: #{command}\n\n#{summarize_setup_output(captured_output)}"}

      {:error, reason} ->
        {:error, inspect(reason)}
    end
  end

  defp wait_for_marker(cell_id, marker, timeout_ms) do
    started_at = System.monotonic_time(:millisecond)
    do_wait_for_marker(cell_id, marker, timeout_ms, started_at, "")
  end

  defp do_wait_for_marker(cell_id, marker, timeout_ms, started_at, buffer) do
    elapsed = System.monotonic_time(:millisecond) - started_at
    remaining = timeout_ms - elapsed

    if remaining <= 0 do
      {:error, :timeout}
    else
      receive do
        {:setup_terminal_data, %{cell_id: ^cell_id, chunk: chunk}} ->
          next_buffer = buffer <> chunk

          case extract_marker_exit(next_buffer, marker) do
            {:ok, exit_code} -> {:ok, exit_code}
            :nomatch -> do_wait_for_marker(cell_id, marker, timeout_ms, started_at, next_buffer)
          end

        {:setup_terminal_exit, %{cell_id: ^cell_id}} ->
          case extract_marker_exit(buffer, marker) do
            {:ok, exit_code} -> {:ok, exit_code}
            :nomatch -> {:error, :unexpected_exit}
          end
      after
        min(remaining, 1_000) ->
          do_wait_for_marker(cell_id, marker, timeout_ms, started_at, buffer)
      end
    end
  end

  defp extract_marker_exit(buffer, marker) do
    regex = Regex.compile!(Regex.escape(marker) <> ":(\\d+)")

    case Regex.run(regex, buffer) do
      [_match, exit_code] ->
        case Integer.parse(exit_code) do
          {value, ""} -> {:ok, value}
          _other -> :nomatch
        end

      _other ->
        :nomatch
    end
  end

  defp wrap_command(command, marker, env) do
    [
      "(",
      export_lines(env),
      command,
      ")",
      "__hive_status=$?",
      "printf '\\n#{marker}:%s\\n' \"$__hive_status\"",
      "unset __hive_status"
    ]
    |> Enum.reject(&(&1 == ""))
    |> Enum.join("\n")
    |> Kernel.<>("\n")
  end

  defp export_lines(env) when map_size(env) == 0, do: ""

  defp export_lines(env) do
    env
    |> Enum.map(fn {key, value} -> "export #{key}=#{shell_escape(to_string(value))}" end)
    |> Enum.join("\n")
  end

  defp shell_escape(value) when is_binary(value) do
    "'" <> String.replace(value, "'", "'\\''") <> "'"
  end

  defp summarize_setup_output(output) when is_binary(output) do
    output
    |> String.trim()
    |> case do
      "" -> "(no setup output captured)"
      trimmed -> trimmed |> String.split("\n") |> Enum.take(-20) |> Enum.join("\n")
    end
  end

  defp setup_command_timeout_ms do
    case System.get_env("HIVE_TEMPLATE_SETUP_COMMAND_TIMEOUT_MS") do
      nil ->
        @setup_command_timeout_ms

      raw ->
        case Integer.parse(raw) do
          {value, ""} when value > 0 -> value
          _other -> @setup_command_timeout_ms
        end
    end
  end
end

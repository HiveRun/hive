defmodule HiveServerElixir.Cells.Terminals.Transport do
  @moduledoc false

  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.CellStatus
  alias HiveServerElixir.Cells.Terminals

  @spec ready_payload(Terminals.scope(), map(), Cell.t() | nil) :: map()
  def ready_payload({:setup, _cell_id}, session, %Cell{} = cell) do
    %{session: session, setupState: CellStatus.setup_state(cell), lastSetupError: nil}
  end

  def ready_payload(_scope, session, _cell), do: %{session: session}

  @spec sse_ready_payload(Terminals.scope(), map(), Cell.t() | nil) :: map()
  def sse_ready_payload({:chat, _cell_id}, session, _cell), do: session
  def sse_ready_payload(scope, session, cell), do: ready_payload(scope, session, cell)

  @spec ready_event(Terminals.scope(), map(), Cell.t() | nil) :: map()
  def ready_event(scope, session, cell) do
    Map.put(ready_payload(scope, session, cell), :type, "ready")
  end

  @spec snapshot_payload([String.t()]) :: map()
  def snapshot_payload(output), do: %{output: output}

  @spec snapshot_event([String.t()]) :: map()
  def snapshot_event(output), do: %{type: "snapshot", output: output}

  @spec data_payload(String.t()) :: map()
  def data_payload(chunk), do: %{chunk: chunk}

  @spec exit_payload(integer() | nil, integer() | nil) :: map()
  def exit_payload(exit_code, signal), do: %{exitCode: exit_code, signal: signal}

  @spec error_payload(String.t()) :: map()
  def error_payload(message), do: %{message: message}

  @spec resized_event(map()) :: map()
  def resized_event(session), do: %{type: "resized", session: session}

  @spec channel_event(term(), Terminals.scope()) :: {:ok, map()} | :ignore
  def channel_event(message, scope) do
    case transport_event(message, scope) do
      {:ok, event, payload} -> {:ok, Map.put(payload, :type, event)}
      :ignore -> :ignore
    end
  end

  @spec sse_event(term(), Terminals.scope()) :: {:ok, String.t(), map()} | :ignore
  def sse_event(message, scope) do
    transport_event(message, scope)
  end

  defp transport_event(
         {:setup_terminal_data, %{cell_id: cell_id, chunk: chunk}},
         {:setup, cell_id}
       ) do
    {:ok, "data", data_payload(chunk)}
  end

  defp transport_event(
         {:setup_terminal_exit, %{cell_id: cell_id, exit_code: exit_code, signal: signal}},
         {:setup, cell_id}
       ) do
    {:ok, "exit", exit_payload(exit_code, signal)}
  end

  defp transport_event(
         {:setup_terminal_error, %{cell_id: cell_id, message: message}},
         {:setup, cell_id}
       ) do
    {:ok, "error", error_payload(message)}
  end

  defp transport_event(
         {:service_terminal_data, %{cell_id: cell_id, service_id: service_id, chunk: chunk}},
         {:service, cell_id, service_id}
       ) do
    {:ok, "data", data_payload(chunk)}
  end

  defp transport_event(
         {:service_terminal_exit,
          %{cell_id: cell_id, service_id: service_id, exit_code: exit_code, signal: signal}},
         {:service, cell_id, service_id}
       ) do
    {:ok, "exit", exit_payload(exit_code, signal)}
  end

  defp transport_event(
         {:service_terminal_error, %{cell_id: cell_id, service_id: service_id, message: message}},
         {:service, cell_id, service_id}
       ) do
    {:ok, "error", error_payload(message)}
  end

  defp transport_event({:chat_terminal_data, %{cell_id: cell_id, chunk: chunk}}, {:chat, cell_id}) do
    {:ok, "data", data_payload(chunk)}
  end

  defp transport_event(
         {:chat_terminal_exit, %{cell_id: cell_id, exit_code: exit_code, signal: signal}},
         {:chat, cell_id}
       ) do
    {:ok, "exit", exit_payload(exit_code, signal)}
  end

  defp transport_event(
         {:chat_terminal_error, %{cell_id: cell_id, message: message}},
         {:chat, cell_id}
       ) do
    {:ok, "error", error_payload(message)}
  end

  defp transport_event(_message, _scope), do: :ignore
end

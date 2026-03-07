defmodule HiveServerElixirWeb.TerminalEvents do
  @moduledoc false

  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.CellStatus
  alias HiveServerElixir.Cells.TerminalRuntime

  @spec ready_payload(atom(), map(), Cell.t() | nil) :: map()
  def ready_payload(:setup, session, %Cell{} = cell) do
    %{session: session, setupState: CellStatus.setup_state(cell), lastSetupError: nil}
  end

  def ready_payload(_kind, session, _cell), do: %{session: session}

  @spec snapshot_payload([String.t()]) :: map()
  def snapshot_payload(output), do: %{output: output}

  @spec data_payload(String.t()) :: map()
  def data_payload(chunk), do: %{chunk: chunk}

  @spec exit_payload(integer() | nil, integer() | nil) :: map()
  def exit_payload(exit_code, signal), do: %{exitCode: exit_code, signal: signal}

  @spec error_payload(String.t()) :: map()
  def error_payload(message), do: %{message: message}

  @spec resized_payload(map()) :: map()
  def resized_payload(session), do: %{type: "resized", session: session}

  @spec ensure_session(atom(), String.t(), String.t() | nil) :: map()
  def ensure_session(:setup, cell_id, _service_id),
    do: TerminalRuntime.ensure_setup_session(cell_id)

  def ensure_session(:chat, cell_id, _service_id),
    do: TerminalRuntime.ensure_chat_session(cell_id)

  def ensure_session(:service, cell_id, service_id) when is_binary(service_id) do
    TerminalRuntime.ensure_service_session(cell_id, service_id)
  end

  @spec read_output(atom(), String.t(), String.t() | nil) :: [String.t()]
  def read_output(:setup, cell_id, _service_id), do: TerminalRuntime.read_setup_output(cell_id)
  def read_output(:chat, cell_id, _service_id), do: TerminalRuntime.read_chat_output(cell_id)

  def read_output(:service, cell_id, service_id) when is_binary(service_id) do
    TerminalRuntime.read_service_output(cell_id, service_id)
  end
end

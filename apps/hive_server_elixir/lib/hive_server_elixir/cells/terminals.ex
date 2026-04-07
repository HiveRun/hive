defmodule HiveServerElixir.Cells.Terminals do
  @moduledoc false

  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.CellStatus
  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.ServiceRuntime
  alias HiveServerElixir.Cells.TerminalRuntime

  @type scope ::
          {:terminal, String.t()}
          | {:setup, String.t()}
          | {:chat, String.t()}
          | {:service, String.t(), String.t()}

  @spec validate_chat_available(Cell.t()) :: :ok | {:error, :chat_unavailable}
  def validate_chat_available(%Cell{} = cell) do
    if CellStatus.ready?(cell), do: :ok, else: {:error, :chat_unavailable}
  end

  def validate_chat_available(_cell), do: {:error, :chat_unavailable}

  @spec get_service_for_cell(String.t(), String.t()) :: {:ok, Service.t()} | {:error, term()}
  def get_service_for_cell(cell_id, service_id) do
    case Ash.get(Service, service_id) do
      {:ok, %Service{cell_id: ^cell_id} = service} -> {:ok, service}
      {:ok, _service} -> {:error, :service_not_found}
      {:error, error} -> {:error, error}
    end
  end

  @spec ensure_service_runtime(Service.t()) :: :ok | {:error, :service_runtime_unavailable}
  def ensure_service_runtime(%Service{} = service) do
    case ServiceRuntime.ensure_service_running(service) do
      :ok -> :ok
      {:error, _reason} -> {:error, :service_runtime_unavailable}
    end
  end

  @spec ensure_session(scope()) :: {:ok, map()} | {:error, term()}
  def ensure_session({:terminal, cell_id}), do: TerminalRuntime.ensure_terminal_session(cell_id)
  def ensure_session({:setup, cell_id}), do: TerminalRuntime.ensure_setup_session(cell_id)
  def ensure_session({:chat, cell_id}), do: TerminalRuntime.ensure_chat_session(cell_id)

  def ensure_session({:service, cell_id, service_id}),
    do: TerminalRuntime.ensure_service_session(cell_id, service_id)

  @spec read_output(scope()) :: String.t()
  def read_output({:terminal, cell_id}), do: TerminalRuntime.read_terminal_output(cell_id)
  def read_output({:setup, cell_id}), do: TerminalRuntime.read_setup_output(cell_id)
  def read_output({:chat, cell_id}), do: TerminalRuntime.read_chat_output(cell_id)

  def read_output({:service, cell_id, service_id}),
    do: TerminalRuntime.read_service_output(cell_id, service_id)

  @spec write_input(scope(), String.t()) :: :ok | {:error, term()}
  def write_input({:terminal, cell_id}, chunk) when is_binary(chunk) do
    TerminalRuntime.write_terminal_input(cell_id, chunk)
  end

  def write_input({:setup, cell_id}, chunk) when is_binary(chunk) do
    TerminalRuntime.write_setup_input(cell_id, chunk)
  end

  def write_input({:chat, cell_id}, chunk) when is_binary(chunk) do
    TerminalRuntime.write_chat_input(cell_id, chunk)
  end

  def write_input({:service, _cell_id, service_id}, chunk)
      when is_binary(service_id) and is_binary(chunk) do
    ServiceRuntime.write_input(service_id, chunk)
  end

  @spec resize_session(scope(), pos_integer(), pos_integer()) :: {:ok, map()} | {:error, term()}
  def resize_session({:terminal, cell_id}, cols, rows),
    do: TerminalRuntime.resize_terminal_session(cell_id, cols, rows)

  def resize_session({:setup, cell_id}, cols, rows),
    do: TerminalRuntime.resize_setup_session(cell_id, cols, rows)

  def resize_session({:chat, cell_id}, cols, rows),
    do: TerminalRuntime.resize_chat_session(cell_id, cols, rows)

  def resize_session({:service, cell_id, service_id}, cols, rows),
    do: TerminalRuntime.resize_service_session(cell_id, service_id, cols, rows)

  @spec restart_session({:terminal, String.t()} | {:chat, String.t()} | {:setup, String.t()}) ::
          {:ok, map()} | {:error, term()}
  def restart_session({:terminal, cell_id}), do: TerminalRuntime.restart_terminal_session(cell_id)
  def restart_session({:chat, cell_id}), do: TerminalRuntime.restart_chat_session(cell_id)
  def restart_session({:setup, cell_id}), do: TerminalRuntime.restart_setup_session(cell_id)
end

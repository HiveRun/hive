defmodule HiveServerElixir.Cells.TerminalRuntime do
  @moduledoc false

  use GenServer

  @type session :: %{
          sessionId: String.t(),
          status: String.t(),
          cols: pos_integer(),
          rows: pos_integer(),
          startedAt: String.t()
        }

  @default_cols 120
  @default_rows 40

  def start_link(opts) do
    GenServer.start_link(__MODULE__, :ok, opts)
  end

  @spec ensure_setup_session(String.t()) :: session()
  def ensure_setup_session(cell_id) when is_binary(cell_id) do
    GenServer.call(__MODULE__, {:ensure_setup_session, cell_id})
  end

  @spec ensure_service_session(String.t(), String.t()) :: session()
  def ensure_service_session(cell_id, service_id)
      when is_binary(cell_id) and is_binary(service_id) do
    GenServer.call(__MODULE__, {:ensure_service_session, cell_id, service_id})
  end

  @spec ensure_chat_session(String.t()) :: session()
  def ensure_chat_session(cell_id) when is_binary(cell_id) do
    GenServer.call(__MODULE__, {:ensure_chat_session, cell_id})
  end

  @spec read_setup_output(String.t()) :: [String.t()]
  def read_setup_output(cell_id) when is_binary(cell_id) do
    GenServer.call(__MODULE__, {:read_setup_output, cell_id})
  end

  @spec read_service_output(String.t(), String.t()) :: [String.t()]
  def read_service_output(cell_id, service_id)
      when is_binary(cell_id) and is_binary(service_id) do
    GenServer.call(__MODULE__, {:read_service_output, cell_id, service_id})
  end

  @spec read_chat_output(String.t()) :: [String.t()]
  def read_chat_output(cell_id) when is_binary(cell_id) do
    GenServer.call(__MODULE__, {:read_chat_output, cell_id})
  end

  @spec write_setup_input(String.t(), String.t()) :: :ok
  def write_setup_input(cell_id, chunk) when is_binary(cell_id) and is_binary(chunk) do
    GenServer.call(__MODULE__, {:write_setup_input, cell_id, chunk})
  end

  @spec append_setup_output(String.t(), String.t()) :: :ok
  def append_setup_output(cell_id, chunk) when is_binary(cell_id) and is_binary(chunk) do
    GenServer.call(__MODULE__, {:append_setup_output, cell_id, chunk})
  end

  @spec write_service_input(String.t(), String.t(), String.t()) :: :ok
  def write_service_input(cell_id, service_id, chunk)
      when is_binary(cell_id) and is_binary(service_id) and is_binary(chunk) do
    GenServer.call(__MODULE__, {:write_service_input, cell_id, service_id, chunk})
  end

  @spec append_service_output(String.t(), String.t(), String.t()) :: :ok
  def append_service_output(cell_id, service_id, chunk)
      when is_binary(cell_id) and is_binary(service_id) and is_binary(chunk) do
    GenServer.call(__MODULE__, {:append_service_output, cell_id, service_id, chunk})
  end

  @spec write_chat_input(String.t(), String.t()) :: :ok
  def write_chat_input(cell_id, chunk) when is_binary(cell_id) and is_binary(chunk) do
    GenServer.call(__MODULE__, {:write_chat_input, cell_id, chunk})
  end

  @spec append_chat_output(String.t(), String.t()) :: :ok
  def append_chat_output(cell_id, chunk) when is_binary(cell_id) and is_binary(chunk) do
    GenServer.call(__MODULE__, {:append_chat_output, cell_id, chunk})
  end

  @spec resize_setup_session(String.t(), pos_integer(), pos_integer()) :: session()
  def resize_setup_session(cell_id, cols, rows)
      when is_binary(cell_id) and is_integer(cols) and cols > 0 and is_integer(rows) and rows > 0 do
    GenServer.call(__MODULE__, {:resize_setup_session, cell_id, cols, rows})
  end

  @spec resize_service_session(String.t(), String.t(), pos_integer(), pos_integer()) :: session()
  def resize_service_session(cell_id, service_id, cols, rows)
      when is_binary(cell_id) and is_binary(service_id) and is_integer(cols) and cols > 0 and
             is_integer(rows) and rows > 0 do
    GenServer.call(__MODULE__, {:resize_service_session, cell_id, service_id, cols, rows})
  end

  @spec resize_chat_session(String.t(), pos_integer(), pos_integer()) :: session()
  def resize_chat_session(cell_id, cols, rows)
      when is_binary(cell_id) and is_integer(cols) and cols > 0 and is_integer(rows) and rows > 0 do
    GenServer.call(__MODULE__, {:resize_chat_session, cell_id, cols, rows})
  end

  @spec restart_chat_session(String.t()) :: session()
  def restart_chat_session(cell_id) when is_binary(cell_id) do
    GenServer.call(__MODULE__, {:restart_chat_session, cell_id})
  end

  @spec clear_cell(String.t()) :: :ok
  def clear_cell(cell_id) when is_binary(cell_id) do
    GenServer.call(__MODULE__, {:clear_cell, cell_id})
  end

  @impl true
  def init(:ok) do
    {:ok, %{sessions: %{}, output: %{}}}
  end

  @impl true
  def handle_call({:ensure_setup_session, cell_id}, _from, state) do
    {session, next_state} = ensure_session(state, {:setup, cell_id}, "setup")
    {:reply, session, next_state}
  end

  def handle_call({:ensure_service_session, cell_id, service_id}, _from, state) do
    {session, next_state} = ensure_session(state, {:service, cell_id, service_id}, "service")
    {:reply, session, next_state}
  end

  def handle_call({:ensure_chat_session, cell_id}, _from, state) do
    {session, next_state} = ensure_session(state, {:chat, cell_id}, "chat")
    {:reply, session, next_state}
  end

  def handle_call({:read_setup_output, cell_id}, _from, state) do
    {:reply, read_output(state, {:setup, cell_id}), state}
  end

  def handle_call({:read_service_output, cell_id, service_id}, _from, state) do
    {:reply, read_output(state, {:service, cell_id, service_id}), state}
  end

  def handle_call({:read_chat_output, cell_id}, _from, state) do
    {:reply, read_output(state, {:chat, cell_id}), state}
  end

  def handle_call({:write_setup_input, cell_id, chunk}, _from, state) do
    {:reply, :ok, append_output(state, {:setup, cell_id}, chunk)}
  end

  def handle_call({:append_setup_output, cell_id, chunk}, _from, state) do
    {:reply, :ok, append_output(state, {:setup, cell_id}, chunk)}
  end

  def handle_call({:write_service_input, cell_id, service_id, chunk}, _from, state) do
    {:reply, :ok, append_output(state, {:service, cell_id, service_id}, chunk)}
  end

  def handle_call({:append_service_output, cell_id, service_id, chunk}, _from, state) do
    {:reply, :ok, append_output(state, {:service, cell_id, service_id}, chunk)}
  end

  def handle_call({:write_chat_input, cell_id, chunk}, _from, state) do
    {:reply, :ok, append_output(state, {:chat, cell_id}, chunk)}
  end

  def handle_call({:append_chat_output, cell_id, chunk}, _from, state) do
    {:reply, :ok, append_output(state, {:chat, cell_id}, chunk)}
  end

  def handle_call({:resize_setup_session, cell_id, cols, rows}, _from, state) do
    {session, next_state} = ensure_session(state, {:setup, cell_id}, "setup", cols, rows)
    {:reply, session, next_state}
  end

  def handle_call({:resize_service_session, cell_id, service_id, cols, rows}, _from, state) do
    {session, next_state} =
      ensure_session(state, {:service, cell_id, service_id}, "service", cols, rows)

    {:reply, session, next_state}
  end

  def handle_call({:resize_chat_session, cell_id, cols, rows}, _from, state) do
    {session, next_state} = ensure_session(state, {:chat, cell_id}, "chat", cols, rows)
    {:reply, session, next_state}
  end

  def handle_call({:restart_chat_session, cell_id}, _from, state) do
    key = {:chat, cell_id}

    session = new_session("chat", cols: @default_cols, rows: @default_rows)

    next_state =
      state
      |> put_session(key, session)
      |> put_output(key, [])

    {:reply, session, next_state}
  end

  def handle_call({:clear_cell, cell_id}, _from, state) do
    sessions =
      state.sessions
      |> Enum.reject(fn {key, _session} -> key_matches_cell?(key, cell_id) end)
      |> Map.new()

    output =
      state.output
      |> Enum.reject(fn {key, _chunks} -> key_matches_cell?(key, cell_id) end)
      |> Map.new()

    {:reply, :ok, %{state | sessions: sessions, output: output}}
  end

  defp ensure_session(state, key, prefix, cols \\ @default_cols, rows \\ @default_rows) do
    case Map.fetch(state.sessions, key) do
      {:ok, session} ->
        next_session = %{session | cols: cols, rows: rows}
        {next_session, put_session(state, key, next_session)}

      :error ->
        session = new_session(prefix, cols: cols, rows: rows)
        {session, put_session(state, key, session)}
    end
  end

  defp put_session(state, key, session) do
    %{state | sessions: Map.put(state.sessions, key, session)}
  end

  defp read_output(state, key) do
    Map.get(state.output, key, [])
  end

  defp put_output(state, key, output) do
    %{state | output: Map.put(state.output, key, output)}
  end

  defp append_output(state, key, chunk) do
    output = read_output(state, key)
    put_output(state, key, output ++ [chunk])
  end

  defp new_session(prefix, opts) do
    cols = Keyword.fetch!(opts, :cols)
    rows = Keyword.fetch!(opts, :rows)

    %{
      sessionId: "#{prefix}_terminal_#{Ash.UUID.generate()}",
      status: "running",
      cols: cols,
      rows: rows,
      startedAt: DateTime.utc_now() |> DateTime.truncate(:second) |> DateTime.to_iso8601()
    }
  end

  defp key_matches_cell?({:setup, key_cell_id}, cell_id), do: key_cell_id == cell_id
  defp key_matches_cell?({:chat, key_cell_id}, cell_id), do: key_cell_id == cell_id

  defp key_matches_cell?({:service, key_cell_id, _service_id}, cell_id),
    do: key_cell_id == cell_id

  defp key_matches_cell?(_key, _cell_id), do: false
end

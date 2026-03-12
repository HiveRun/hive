defmodule HiveServerElixir.Cells.TerminalRuntime do
  @moduledoc false

  use GenServer

  import Ash.Expr
  require Ash.Query

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.TerminalSession

  @type session :: %{
          sessionId: String.t(),
          status: String.t(),
          cols: pos_integer(),
          rows: pos_integer(),
          startedAt: String.t()
        }

  @default_cols 120
  @default_rows 40
  @max_output_chunks 1000

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
    _ = persist_restart(key, session)

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

    _ = close_terminal_sessions(cell_id)

    {:reply, :ok, %{state | sessions: sessions, output: output}}
  end

  defp ensure_session(state, key, prefix, cols \\ @default_cols, rows \\ @default_rows) do
    case Map.fetch(state.sessions, key) do
      {:ok, session} ->
        next_session = %{session | cols: cols, rows: rows}
        _ = persist_resize(key, next_session)
        {next_session, put_session(state, key, next_session)}

      :error ->
        session = new_session(prefix, cols: cols, rows: rows)
        _ = persist_open(key, session)
        {session, put_session(state, key, session)}
    end
  end

  defp put_session(state, key, session) do
    %{state | sessions: Map.put(state.sessions, key, session)}
  end

  defp read_output(state, key) do
    state.output
    |> Map.get(key, [])
    |> Enum.reverse()
  end

  defp put_output(state, key, output) do
    %{state | output: Map.put(state.output, key, output)}
  end

  defp append_output(state, key, chunk) do
    output = Map.get(state.output, key, [])
    put_output(state, key, [chunk | output] |> Enum.take(@max_output_chunks))
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

  defp persist_open(key, session) when is_map(session) do
    attrs =
      key
      |> terminal_session_attrs(session)
      |> Map.put(:session_key, session_key(key))

    Ash.create(TerminalSession, attrs, action: :open, domain: Cells)
  end

  defp persist_resize(key, session) when is_map(session) do
    with %TerminalSession{} = terminal_session <- terminal_session_for_key(session_key(key)),
         {:ok, _updated} <-
           Ash.update(
             terminal_session,
             %{cols: session.cols, rows: session.rows},
             action: :resize,
             domain: Cells
           ) do
      :ok
    else
      _other -> :ok
    end
  end

  defp persist_restart(key, session) when is_map(session) do
    with %TerminalSession{} = terminal_session <- terminal_session_for_key(session_key(key)),
         {:ok, _updated} <-
           Ash.update(
             terminal_session,
             %{runtime_session_id: session.sessionId, cols: session.cols, rows: session.rows},
             action: :restart,
             domain: Cells
           ) do
      :ok
    else
      _other -> persist_open(key, session)
    end
  end

  defp close_terminal_sessions(cell_id) do
    if valid_uuid?(cell_id) do
      cell_id
      |> terminal_sessions_for_cell()
      |> Enum.each(fn terminal_session ->
        _ = Ash.update(terminal_session, %{}, action: :close, domain: Cells)
      end)
    end

    :ok
  end

  defp terminal_sessions_for_cell(cell_id) do
    TerminalSession
    |> Ash.Query.filter(expr(cell_id == ^cell_id))
    |> Ash.read!(domain: Cells)
  end

  defp terminal_session_for_key(session_key) do
    TerminalSession
    |> Ash.Query.filter(expr(session_key == ^session_key))
    |> Ash.read_one!(domain: Cells)
  end

  defp terminal_session_attrs({:setup, cell_id}, session) do
    %{
      cell_id: cell_id,
      kind: :setup,
      runtime_session_id: session.sessionId,
      cols: session.cols,
      rows: session.rows
    }
  end

  defp terminal_session_attrs({:chat, cell_id}, session) do
    %{
      cell_id: cell_id,
      kind: :chat,
      runtime_session_id: session.sessionId,
      cols: session.cols,
      rows: session.rows
    }
  end

  defp terminal_session_attrs({:service, cell_id, service_id}, session) do
    %{
      cell_id: cell_id,
      service_id: service_id,
      kind: :service,
      runtime_session_id: session.sessionId,
      cols: session.cols,
      rows: session.rows
    }
  end

  defp session_key({:setup, cell_id}), do: "setup:" <> cell_id
  defp session_key({:chat, cell_id}), do: "chat:" <> cell_id
  defp session_key({:service, _cell_id, service_id}), do: "service:" <> service_id

  defp valid_uuid?(value) when is_binary(value) do
    match?({:ok, _uuid}, Ecto.UUID.cast(value))
  end

  defp valid_uuid?(_value), do: false

  defp key_matches_cell?({:setup, key_cell_id}, cell_id), do: key_cell_id == cell_id
  defp key_matches_cell?({:chat, key_cell_id}, cell_id), do: key_cell_id == cell_id

  defp key_matches_cell?({:service, key_cell_id, _service_id}, cell_id),
    do: key_cell_id == cell_id

  defp key_matches_cell?(_key, _cell_id), do: false
end

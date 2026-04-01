defmodule HiveServerElixir.Cells.Terminals.SessionServer do
  @moduledoc false

  use GenServer

  alias HiveServerElixir.Cells.Events
  alias HiveServerElixir.Cells.ServiceRuntime
  alias HiveServerElixir.Cells.TerminalSession
  alias HiveServerElixir.Cells.Terminals.Buffer
  alias HiveServerElixir.Cells.Terminals.SessionSpec

  import Ash.Expr
  require Ash.Query
  require Logger

  @default_kill_timeout 2_000
  @plan_mode_status_pattern ~r/\b(Plan|Build)\b/
  @plan_mode_poll_interval_ms 300
  @plan_mode_switch_retry_ms 2_000
  @plan_mode_timeout_ms 12_000
  @chat_prompt_flush_ms 500
  @ascii_end_of_text <<3>>
  @ascii_end_of_transmission <<4>>

  def start_link(%SessionSpec{} = spec) do
    GenServer.start_link(__MODULE__, spec, name: via_tuple(spec.scope))
  end

  def via_tuple(scope) do
    {:via, Registry, {HiveServerElixir.Cells.TerminalRuntime.Registry, scope}}
  end

  def child_spec(%SessionSpec{} = spec) do
    %{
      id: {:terminal_session, spec.scope},
      start: {__MODULE__, :start_link, [spec]},
      restart: :transient
    }
  end

  def init(%SessionSpec{} = spec) do
    Process.flag(:trap_exit, true)

    case start_process(%{
           spec: spec,
           scope: spec.scope,
           generation: 0,
           process: nil,
           session: nil,
           buffer: Buffer.empty(spec.buffer_kind),
           exit_directives: %{},
           chat_prompt_buffer: "",
           chat_prompt_timer_ref: nil
         }) do
      {:ok, state} -> {:ok, state}
      {:error, reason} -> {:stop, reason}
    end
  end

  def handle_call(:session, _from, state) do
    {:reply, {:ok, state.session}, state}
  end

  def handle_call(:snapshot, _from, state) do
    {:reply, {:ok, state.buffer}, state}
  end

  def handle_call(:runtime_status, _from, state) do
    {:reply, runtime_status_payload(state), state}
  end

  def handle_call({:ensure_spec, %SessionSpec{} = spec}, _from, state) do
    state = maybe_resize(state, spec.cols, spec.rows)

    if state.spec.fingerprint == spec.fingerprint and state.session.status == "running" do
      {:reply, {:ok, state.session},
       %{state | spec: %{spec | cols: state.session.cols, rows: state.session.rows}}}
    else
      case restart_with_spec(state, spec,
             publish_terminal_exit?: false,
             notify_service_runtime?: false
           ) do
        {:ok, next_state} -> {:reply, {:ok, next_state.session}, next_state}
        {:error, reason, next_state} -> {:reply, {:error, reason}, next_state}
      end
    end
  end

  def handle_call({:write, chunk}, _from, state) do
    if state.session.status != "running" do
      {:reply, {:error, :not_running}, state}
    else
      if blocked_control_input?(state.spec, chunk) do
        {:reply, :ok, state}
      else
        normalized_chunk = normalize_input(state.spec, chunk)

        case maybe_submit_chat_prompt(state, normalized_chunk) do
          {:handled, next_state} ->
            {:reply, :ok, next_state}

          {:passthrough, next_state} ->
            {:reply, NetRunner.Process.write(state.process, normalized_chunk), next_state}
        end
      end
    end
  end

  def handle_call({:inject, chunk}, _from, state) do
    next_state = append_and_publish_output(state, chunk, publish?: true)
    {:reply, :ok, next_state}
  end

  def handle_call({:resize, cols, rows}, _from, state) do
    if state.session.status == "running" do
      :ok = NetRunner.Process.set_window_size(state.process, rows, cols)
    end

    next_session = %{state.session | cols: cols, rows: rows}
    persist_resize(state.scope, next_session)

    {:reply, {:ok, next_session},
     %{state | session: next_session, spec: %{state.spec | cols: cols, rows: rows}}}
  end

  def handle_call({:restart, %SessionSpec{} = spec, opts}, _from, state) do
    case restart_with_spec(state, spec, opts) do
      {:ok, next_state} -> {:reply, {:ok, next_state.session}, next_state}
      {:error, reason, next_state} -> {:reply, {:error, reason}, next_state}
    end
  end

  def handle_call({:terminate, opts}, _from, state) do
    next_state = terminate_process(state, opts)
    {:reply, :ok, next_state}
  end

  def handle_info({:process_output, generation, chunk}, %{generation: generation} = state) do
    next_state = append_and_publish_output(state, chunk, publish?: true)
    {:noreply, next_state}
  end

  def handle_info({:process_output, _generation, _chunk}, state), do: {:noreply, state}

  def handle_info(
        {:process_exit, generation, {:ok, exit_code}},
        state
      ) do
    {:noreply, finish_exit(state, generation, exit_code)}
  end

  def handle_info(
        {:process_exit, generation, {:error, reason}},
        state
      ) do
    next_state =
      if generation == state.generation,
        do: publish_terminal_error(state, inspect(reason)),
        else: state

    {:noreply, finish_exit(next_state, generation, nil)}
  end

  def handle_info({:schedule_plan_mode_switch, generation}, %{generation: generation} = state) do
    {:noreply, maybe_plan_mode_switch(state)}
  end

  def handle_info({:flush_chat_prompt, generation}, %{generation: generation} = state) do
    {:noreply, flush_chat_prompt(state)}
  end

  def handle_info({:flush_chat_prompt, _generation}, state), do: {:noreply, state}

  def handle_info(_message, state), do: {:noreply, state}

  def terminate(_reason, state) do
    if state[:process] && state.session && state.session.status == "running" do
      _ = NetRunner.Process.kill(state.process, :sigterm)
    end

    :ok
  end

  defp maybe_resize(state, cols, rows) do
    next_spec = %{state.spec | cols: cols, rows: rows}
    next_session = %{state.session | cols: cols, rows: rows}

    if state.session.status == "running" and
         (cols != state.session.cols or rows != state.session.rows) do
      :ok = NetRunner.Process.set_window_size(state.process, rows, cols)
      persist_resize(state.scope, next_session)
    end

    %{state | spec: next_spec, session: next_session}
  end

  defp start_process(state) do
    spec = state.spec

    case NetRunner.Process.start(spec.command, spec.args,
           pty: true,
           kill_timeout: @default_kill_timeout
         ) do
      {:ok, process} ->
        generation = state.generation + 1
        os_pid = NetRunner.Process.os_pid(process)

        session = %{
          sessionId: session_id(spec),
          cellId: cell_id_for_scope(spec.scope),
          pid: os_pid,
          cwd: spec.cwd,
          cols: spec.cols,
          rows: spec.rows,
          status: "running",
          exitCode: nil,
          startedAt: DateTime.utc_now() |> DateTime.truncate(:second) |> DateTime.to_iso8601()
        }

        :ok = NetRunner.Process.set_window_size(process, spec.rows, spec.cols)
        persist_open(spec.scope, session)
        start_reader(process, generation)
        start_awaiter(process, generation)

        next_state = %{
          state
          | process: process,
            generation: generation,
            session: session,
            spec: spec,
            buffer: state.buffer,
            scope: spec.scope,
            exit_directives: Map.delete(state.exit_directives, generation)
        }

        next_state = maybe_schedule_plan_mode(next_state)
        {:ok, next_state}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp start_reader(process, generation) do
    server = self()

    Task.start_link(fn ->
      read_loop(server, process, generation)
    end)
  end

  defp read_loop(server, process, generation) do
    case NetRunner.Process.read(process) do
      {:ok, chunk} ->
        send(server, {:process_output, generation, chunk})
        read_loop(server, process, generation)

      :eof ->
        :ok

      {:error, _reason} ->
        :ok
    end
  end

  defp start_awaiter(process, generation) do
    server = self()

    Task.start_link(fn ->
      send(server, {:process_exit, generation, NetRunner.Process.await_exit(process)})
    end)
  end

  defp restart_with_spec(state, spec, opts) do
    state = terminate_process(state, Keyword.put_new(opts, :close_terminal_session?, false))
    state = %{state | spec: spec, buffer: Buffer.empty(spec.buffer_kind)}

    case start_process(state) do
      {:ok, next_state} ->
        persist_restart(spec.scope, next_state.session)
        {:ok, next_state}

      {:error, reason} ->
        {:error, reason, state}
    end
  end

  defp terminate_process(state, opts) do
    publish_terminal_exit? = Keyword.get(opts, :publish_terminal_exit?, false)
    notify_service_runtime? = Keyword.get(opts, :notify_service_runtime?, false)
    close_terminal_session? = Keyword.get(opts, :close_terminal_session?, true)

    if state[:process] && state.session.status == "running" do
      generation = state.generation

      exit_directives =
        Map.put(state.exit_directives, generation, %{
          publish_terminal_exit?: publish_terminal_exit?,
          notify_service_runtime?: notify_service_runtime?,
          close_terminal_session?: close_terminal_session?
        })

      _ = NetRunner.Process.kill(state.process, :sigterm)

      %{state | exit_directives: exit_directives}
    else
      if close_terminal_session? do
        persist_close(state.scope)
      end

      state
    end
  end

  defp finish_exit(state, generation, exit_code) do
    directives =
      Map.get(state.exit_directives, generation, %{
        publish_terminal_exit?: true,
        notify_service_runtime?: true,
        close_terminal_session?: true
      })

    if directives.close_terminal_session? and generation == state.generation do
      persist_close(state.scope)
    end

    if directives.publish_terminal_exit? and generation == state.generation do
      publish_terminal_exit(state.scope, exit_code)
    end

    if directives.notify_service_runtime? do
      notify_service_runtime_exit(state.scope, exit_code)
    end

    if generation == state.generation do
      %{
        state
        | process: nil,
          session: %{state.session | status: "exited", exitCode: exit_code},
          exit_directives: Map.delete(state.exit_directives, generation)
      }
    else
      %{state | exit_directives: Map.delete(state.exit_directives, generation)}
    end
  end

  defp append_and_publish_output(state, chunk, opts) do
    safe_chunk = if String.valid?(chunk), do: chunk, else: String.replace_invalid(chunk, "")
    next_buffer = Buffer.append(state.buffer, safe_chunk, state.spec.buffer_kind)

    if Keyword.get(opts, :publish?, false) do
      publish_terminal_data(state.scope, safe_chunk)
    end

    %{state | buffer: next_buffer}
  end

  defp publish_terminal_data({:terminal, cell_id}, chunk),
    do: Events.publish_cell_terminal_data(cell_id, chunk)

  defp publish_terminal_data({:setup, cell_id}, chunk),
    do: Events.publish_setup_terminal_data(cell_id, chunk)

  defp publish_terminal_data({:chat, cell_id}, chunk),
    do: Events.publish_chat_terminal_data(cell_id, chunk)

  defp publish_terminal_data({:service, cell_id, service_id}, chunk),
    do: Events.publish_service_terminal_data(cell_id, service_id, chunk)

  defp publish_terminal_exit({:terminal, cell_id}, exit_code),
    do: Events.publish_cell_terminal_exit(cell_id, exit_code, nil)

  defp publish_terminal_exit({:setup, cell_id}, exit_code),
    do: Events.publish_setup_terminal_exit(cell_id, exit_code, nil)

  defp publish_terminal_exit({:chat, cell_id}, exit_code),
    do: Events.publish_chat_terminal_exit(cell_id, exit_code, nil)

  defp publish_terminal_exit({:service, cell_id, service_id}, exit_code),
    do: Events.publish_service_terminal_exit(cell_id, service_id, exit_code, nil)

  defp publish_terminal_error(state, message) do
    case state.scope do
      {:terminal, cell_id} ->
        Events.publish_cell_terminal_error(cell_id, message)

      {:setup, cell_id} ->
        Events.publish_setup_terminal_error(cell_id, message)

      {:chat, cell_id} ->
        Events.publish_chat_terminal_error(cell_id, message)

      {:service, cell_id, service_id} ->
        Events.publish_service_terminal_error(cell_id, service_id, message)
    end

    state
  end

  defp notify_service_runtime_exit({:service, cell_id, service_id}, exit_code),
    do: ServiceRuntime.notify_terminal_exit(cell_id, service_id, exit_code)

  defp notify_service_runtime_exit(_scope, _exit_code), do: :ok

  defp maybe_schedule_plan_mode(%{spec: %{plan_mode: true}} = state) do
    Process.send_after(
      self(),
      {:schedule_plan_mode_switch, state.generation},
      @plan_mode_poll_interval_ms
    )

    Map.put(state, :plan_mode_started_at_ms, System.monotonic_time(:millisecond))
  end

  defp maybe_schedule_plan_mode(state), do: state

  defp maybe_plan_mode_switch(%{spec: %{plan_mode: true}, session: %{status: "running"}} = state) do
    now = System.monotonic_time(:millisecond)
    started_at = Map.get(state, :plan_mode_started_at_ms, now)
    elapsed = now - started_at
    mode = extract_terminal_mode(state.buffer)
    last_tab_at = Map.get(state, :plan_mode_last_tab_at_ms)

    cond do
      mode == :plan ->
        state

      elapsed >= @plan_mode_timeout_ms ->
        state

      mode == :build and (is_nil(last_tab_at) or now - last_tab_at >= @plan_mode_switch_retry_ms) ->
        :ok = NetRunner.Process.write(state.process, "\t")

        Process.send_after(
          self(),
          {:schedule_plan_mode_switch, state.generation},
          @plan_mode_poll_interval_ms
        )

        Map.put(state, :plan_mode_last_tab_at_ms, now)

      true ->
        Process.send_after(
          self(),
          {:schedule_plan_mode_switch, state.generation},
          @plan_mode_poll_interval_ms
        )

        state
    end
  end

  defp maybe_plan_mode_switch(state), do: state

  defp extract_terminal_mode(buffer) do
    visible_buffer = strip_ansi_sequences(buffer)

    case Regex.scan(@plan_mode_status_pattern, visible_buffer) |> List.last() do
      [match] when is_binary(match) ->
        cond do
          String.starts_with?(match, "Plan") -> :plan
          String.starts_with?(match, "Build") -> :build
          true -> nil
        end

      _other ->
        nil
    end
  end

  defp strip_ansi_sequences(buffer) do
    buffer
    |> String.replace(~r/\e\[[0-?]*[ -\/]*[@-~]/, "")
    |> String.replace(~r/\e\][^\a]*(?:\a|\e\\)/, "")
  end

  defp blocked_control_input?(%SessionSpec{kind: :chat, allow_control_input: false}, chunk) do
    chunk in [@ascii_end_of_text, @ascii_end_of_transmission]
  end

  defp blocked_control_input?(_spec, _chunk), do: false

  defp normalize_input(%SessionSpec{kind: :chat}, chunk) do
    String.replace(chunk, "\r", "\n")
  end

  defp normalize_input(_spec, chunk), do: chunk

  defp maybe_submit_chat_prompt(%{spec: %SessionSpec{kind: :chat}} = state, chunk) do
    if prompt_chunk?(chunk) do
      {:handled, queue_chat_prompt(state, chunk)}
    else
      {:passthrough, state}
    end
  end

  defp maybe_submit_chat_prompt(state, _chunk), do: {:passthrough, state}

  defp prompt_chunk?(chunk) do
    String.valid?(chunk) and not String.contains?(chunk, "\e")
  end

  defp queue_chat_prompt(state, chunk) do
    if state.chat_prompt_timer_ref do
      Process.cancel_timer(state.chat_prompt_timer_ref)
    end

    timer_ref =
      Process.send_after(self(), {:flush_chat_prompt, state.generation}, @chat_prompt_flush_ms)

    %{
      state
      | chat_prompt_buffer: state.chat_prompt_buffer <> chunk,
        chat_prompt_timer_ref: timer_ref
    }
  end

  defp flush_chat_prompt(%{chat_prompt_buffer: ""} = state) do
    %{state | chat_prompt_timer_ref: nil}
  end

  defp flush_chat_prompt(state) do
    prompt = String.trim(state.chat_prompt_buffer)

    next_state = %{state | chat_prompt_buffer: "", chat_prompt_timer_ref: nil}

    case prompt do
      "" ->
        next_state

      _value ->
        case submit_chat_prompt(state, prompt) do
          :ok -> next_state
          {:error, _reason} -> next_state
        end
    end
  end

  defp submit_chat_prompt(state, prompt) do
    cell_id = cell_id_for_scope(state.scope)

    if System.get_env("HIVE_LOG_CHAT_INPUT") == "1" do
      Logger.info("submit_chat_prompt cell_id=#{cell_id} prompt=#{inspect(prompt)}")
    end

    with %HiveServerElixir.Cells.AgentSession{} = agent_session <-
           HiveServerElixir.Cells.AgentSession.fetch_for_cell(cell_id) do
      params = %{
        parts: [%{type: "text", text: prompt}]
      }

      params =
        if is_binary(agent_session.current_mode) do
          Map.put(params, :agent, agent_session.current_mode)
        else
          params
        end

      params =
        if is_binary(agent_session.model_provider_id) and is_binary(agent_session.model_id) do
          Map.put(params, :model, %{
            providerID: agent_session.model_provider_id,
            modelID: agent_session.model_id
          })
        else
          params
        end

      case OpenCode.Generated.Operations.session_prompt_async(
             agent_session.session_id,
             params,
             base_url: HiveServerElixir.Opencode.ServerManager.resolved_base_url(),
             directory: state.session.cwd
           ) do
        {:ok, payload} ->
          if System.get_env("HIVE_LOG_CHAT_INPUT") == "1" do
            Logger.info("submit_chat_prompt ok cell_id=#{cell_id} payload=#{inspect(payload)}")
          end

          :ok

        {:error, error} ->
          if System.get_env("HIVE_LOG_CHAT_INPUT") == "1" do
            Logger.info("submit_chat_prompt error cell_id=#{cell_id} error=#{inspect(error)}")
          end

          {:error, error}

        :error ->
          if System.get_env("HIVE_LOG_CHAT_INPUT") == "1" do
            Logger.info("submit_chat_prompt error cell_id=#{cell_id} error=:prompt_failed")
          end

          {:error, :prompt_failed}
      end
    else
      other ->
        if System.get_env("HIVE_LOG_CHAT_INPUT") == "1" do
          Logger.info("submit_chat_prompt error cell_id=#{cell_id} error=#{inspect(other)}")
        end

        {:error, :session_unavailable}
    end
  end

  defp runtime_status_payload(%{session: %{status: "running", pid: pid}}),
    do: %{status: "running", pid: pid}

  defp runtime_status_payload(_state), do: nil

  defp session_id(%SessionSpec{session_prefix: prefix}), do: prefix <> "_" <> Ash.UUID.generate()

  defp cell_id_for_scope({:terminal, cell_id}), do: cell_id
  defp cell_id_for_scope({:setup, cell_id}), do: cell_id
  defp cell_id_for_scope({:chat, cell_id}), do: cell_id
  defp cell_id_for_scope({:service, cell_id, _service_id}), do: cell_id

  defp persist_open(scope, session) do
    attrs = scope |> terminal_session_attrs(session) |> Map.put(:session_key, session_key(scope))

    safe_persist(fn ->
      _ = Ash.create(TerminalSession, attrs, action: :open)
      :ok
    end)
  end

  defp persist_resize(scope, session) do
    safe_persist(fn ->
      with %TerminalSession{} = terminal_session <- terminal_session_for_key(session_key(scope)),
           {:ok, _updated} <-
             Ash.update(terminal_session, %{cols: session.cols, rows: session.rows},
               action: :resize
             ) do
        :ok
      else
        _other -> :ok
      end
    end)
  end

  defp persist_restart(scope, session) do
    safe_persist(fn ->
      with %TerminalSession{} = terminal_session <- terminal_session_for_key(session_key(scope)),
           {:ok, _updated} <-
             Ash.update(
               terminal_session,
               %{runtime_session_id: session.sessionId, cols: session.cols, rows: session.rows},
               action: :restart
             ) do
        :ok
      else
        _other -> persist_open(scope, session)
      end
    end)
  end

  defp persist_close(scope) do
    safe_persist(fn ->
      with %TerminalSession{} = terminal_session <- terminal_session_for_key(session_key(scope)),
           {:ok, _updated} <- Ash.update(terminal_session, %{}, action: :close) do
        :ok
      else
        _other -> :ok
      end
    end)
  end

  defp terminal_session_for_key(session_key) do
    TerminalSession
    |> Ash.Query.filter(expr(session_key == ^session_key))
    |> Ash.read_one!()
  end

  defp terminal_session_attrs({:terminal, cell_id}, session) do
    %{
      cell_id: cell_id,
      kind: :terminal,
      runtime_session_id: session.sessionId,
      cols: session.cols,
      rows: session.rows
    }
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

  defp session_key({:terminal, cell_id}), do: "terminal:" <> cell_id
  defp session_key({:setup, cell_id}), do: "setup:" <> cell_id
  defp session_key({:chat, cell_id}), do: "chat:" <> cell_id
  defp session_key({:service, _cell_id, service_id}), do: "service:" <> service_id

  defp safe_persist(fun) when is_function(fun, 0) do
    fun.()
  rescue
    _error -> :ok
  catch
    _kind, _reason -> :ok
  end
end

defmodule HiveServerElixir.Opencode.EventIngestWorker do
  @moduledoc false

  use GenServer

  require Logger

  alias HiveServerElixir.Opencode.Adapter
  alias HiveServerElixir.Opencode.EventIngest
  alias HiveServerElixir.Opencode.AgentEventLog

  @type state :: %{
          context: map,
          adapter_opts: keyword,
          persist_global_event: (map, map -> :ok | {:ok, term} | {:error, term}),
          success_delay_ms: non_neg_integer,
          error_delay_ms: non_neg_integer,
          project_global_event: (map, map -> :ok),
          consumer_pid: pid() | nil,
          consumer_ref: reference() | nil,
          last_stream_error: Adapter.normalized_error() | nil
        }

  @spec start_link(keyword) :: GenServer.on_start()
  def start_link(opts) when is_list(opts) do
    name = Keyword.fetch!(opts, :name)
    GenServer.start_link(__MODULE__, opts, name: name)
  end

  @impl true
  def init(opts) do
    state = %{
      context: Keyword.fetch!(opts, :context),
      adapter_opts: Keyword.get(opts, :adapter_opts, []),
      persist_global_event:
        Keyword.get(opts, :persist_global_event, &AgentEventLog.append_global_event/2),
      success_delay_ms: Keyword.get(opts, :success_delay_ms, 0),
      error_delay_ms: Keyword.get(opts, :error_delay_ms, 1_000),
      project_global_event:
        Keyword.get(opts, :project_global_event, fn _context, _event -> :ok end),
      consumer_pid: nil,
      consumer_ref: nil,
      last_stream_error: nil
    }

    send(self(), :connect)
    {:ok, state}
  end

  @impl true
  def handle_info(:connect, state) do
    {:ok, stream} = Adapter.global_event_stream(state.adapter_opts)
    {consumer_pid, consumer_ref} = start_consumer(stream, self())

    {:noreply,
     %{state | consumer_pid: consumer_pid, consumer_ref: consumer_ref, last_stream_error: nil}}
  end

  @impl true
  def handle_info({:stream_item, consumer_pid, item}, %{consumer_pid: consumer_pid} = state) do
    next_state =
      case EventIngest.ingest_stream_item(item, state.context,
             persist_global_event: state.persist_global_event
           ) do
        {:ok, event} ->
          safe_project_event(state.project_global_event, state.context, event)
          %{state | last_stream_error: nil}

        :skip ->
          state

        {:error, error} ->
          Logger.warning("OpenCode ingest failed: #{error.message}")
          %{state | last_stream_error: error}
      end

    {:noreply, next_state}
  end

  def handle_info({:stream_item, _other_pid, _item}, state), do: {:noreply, state}

  @impl true
  def handle_info(
        {:DOWN, ref, :process, pid, reason},
        %{consumer_ref: ref, consumer_pid: pid} = state
      ) do
    delay_ms = reconnect_delay(reason, state)

    schedule_connect(delay_ms)

    {:noreply, %{state | consumer_pid: nil, consumer_ref: nil, last_stream_error: nil}}
  end

  def handle_info({:DOWN, _ref, :process, _pid, _reason}, state), do: {:noreply, state}

  @impl true
  def terminate(_reason, %{consumer_pid: consumer_pid}) when is_pid(consumer_pid) do
    Process.exit(consumer_pid, :shutdown)
    :ok
  end

  def terminate(_reason, _state), do: :ok

  defp reconnect_delay(:normal, %{last_stream_error: nil, success_delay_ms: delay_ms}),
    do: delay_ms

  defp reconnect_delay(_reason, %{error_delay_ms: delay_ms}), do: delay_ms

  defp schedule_connect(0), do: send(self(), :connect)
  defp schedule_connect(delay_ms), do: Process.send_after(self(), :connect, delay_ms)

  defp start_consumer(stream, parent) do
    spawn_monitor(fn ->
      Enum.reduce_while(stream, :ok, fn item, _acc ->
        send(parent, {:stream_item, self(), item})

        case item do
          {:error, _reason} -> {:halt, :ok}
          _other -> {:cont, :ok}
        end
      end)
    end)
  end

  defp safe_project_event(project_global_event, context, event)
       when is_function(project_global_event, 2) do
    project_global_event.(context, event)
  rescue
    error ->
      Logger.warning("OpenCode event projection failed: #{Exception.message(error)}")
  end
end

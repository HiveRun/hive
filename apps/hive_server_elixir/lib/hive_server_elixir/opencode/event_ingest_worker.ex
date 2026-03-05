defmodule HiveServerElixir.Opencode.EventIngestWorker do
  @moduledoc false

  use GenServer

  require Logger

  alias HiveServerElixir.Opencode.EventIngest

  @type state :: %{
          context: map,
          adapter_opts: keyword,
          success_delay_ms: non_neg_integer,
          error_delay_ms: non_neg_integer,
          project_global_event: (map, map -> :ok)
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
      success_delay_ms: Keyword.get(opts, :success_delay_ms, 0),
      error_delay_ms: Keyword.get(opts, :error_delay_ms, 1_000),
      project_global_event:
        Keyword.get(opts, :project_global_event, fn _context, _event -> :ok end)
    }

    send(self(), :ingest)
    {:ok, state}
  end

  @impl true
  def handle_info(:ingest, state) do
    delay_ms =
      case EventIngest.ingest_next(state.context, state.adapter_opts) do
        {:ok, event} ->
          safe_project_event(state.project_global_event, state.context, event)
          state.success_delay_ms

        {:error, error} ->
          Logger.warning("OpenCode ingest failed: #{error.message}")
          state.error_delay_ms
      end

    schedule_ingest(delay_ms)
    {:noreply, state}
  end

  defp schedule_ingest(0), do: send(self(), :ingest)
  defp schedule_ingest(delay_ms), do: Process.send_after(self(), :ingest, delay_ms)

  defp safe_project_event(project_global_event, context, event)
       when is_function(project_global_event, 2) do
    project_global_event.(context, event)
  rescue
    error ->
      Logger.warning("OpenCode event projection failed: #{Exception.message(error)}")
  end
end

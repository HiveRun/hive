defmodule HiveServerElixir.Cells.ProvisioningWorker do
  @moduledoc false

  use GenServer

  require Logger

  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Events
  alias HiveServerElixir.Cells.Lifecycle
  alias HiveServerElixir.Cells.TemplateConfig
  alias HiveServerElixir.Cells.TemplateRuntime
  alias HiveServerElixir.Cells.WorkspaceSnapshot

  def child_spec(opts) do
    %{
      id: {__MODULE__, Keyword.fetch!(opts, :cell_id)},
      start: {__MODULE__, :start_link, [opts]},
      restart: :temporary
    }
  end

  def start_link(opts) when is_list(opts) do
    name = Keyword.fetch!(opts, :name)
    GenServer.start_link(__MODULE__, opts, name: name)
  end

  def run_once(opts) when is_list(opts) do
    state = %{
      cell_id: Keyword.fetch!(opts, :cell_id),
      mode: Keyword.fetch!(opts, :mode),
      runtime_opts: Keyword.get(opts, :runtime_opts, []),
      fail_after_ingest: Keyword.get(opts, :fail_after_ingest, false)
    }

    run_provisioning(state)
  end

  @impl true
  def init(opts) do
    state = %{
      cell_id: Keyword.fetch!(opts, :cell_id),
      mode: Keyword.fetch!(opts, :mode),
      runtime_opts: Keyword.get(opts, :runtime_opts, []),
      fail_after_ingest: Keyword.get(opts, :fail_after_ingest, false)
    }

    {:ok, state, {:continue, :run}}
  end

  @impl true
  def handle_continue(:run, state) do
    _ = run_provisioning(state)
    {:stop, :normal, state}
  end

  defp run_provisioning(%{cell_id: cell_id, mode: mode} = state) do
    with {:ok, cell} <- load_cell(cell_id),
         {:ok, prepared_cell} <- maybe_prepare_workspace(mode, cell),
         {:ok, ingest_context} <- {:ok, Cell.ingest_context(prepared_cell)},
         {:ok, _pid} <- restart_ingest(mode, ingest_context, state.runtime_opts),
         :ok <- after_ingest_check(prepared_cell, state.fail_after_ingest),
         {:ok, runtime_result} <- apply_template_runtime(mode, prepared_cell),
         {:ok, updated_cell} <- Cell.finalize_template_runtime(prepared_cell, runtime_result),
         :ok <- Cell.emit_terminal_state(updated_cell),
         :ok <- Events.publish_cell_status(updated_cell.workspace_id, updated_cell.id) do
      {:ok, updated_cell}
    else
      {:cancelled, _reason} ->
        :ok

      {:error, reason} ->
        finalize_async_error(cell_id, reason)
    end
  end

  defp load_cell(cell_id) do
    case Ash.get(Cell, cell_id) do
      {:ok, cell} -> {:ok, cell}
      {:error, _error} -> {:cancelled, :cell_not_found}
    end
  end

  defp maybe_prepare_workspace(:create, cell) do
    source_root = cell.workspace_root_path || cell.workspace_path
    ignore_patterns = template_ignore_patterns(cell)

    cond do
      not is_binary(source_root) ->
        {:ok, cell}

      not File.dir?(source_root) ->
        {:ok, cell}

      true ->
        with {:ok, workspace_path} <-
               WorkspaceSnapshot.ensure_cell_workspace(cell.id, source_root, ignore_patterns),
             {:ok, updated_cell} <- Ash.update(cell, %{workspace_path: workspace_path}) do
          {:ok, updated_cell}
        end
    end
  end

  defp maybe_prepare_workspace(_mode, cell), do: {:ok, cell}

  defp restart_ingest(:create, context, runtime_opts),
    do: Lifecycle.on_cell_create(context, runtime_opts)

  defp restart_ingest(:retry, context, runtime_opts),
    do: Lifecycle.on_cell_retry(context, runtime_opts)

  defp restart_ingest(:resume, context, runtime_opts),
    do: Lifecycle.on_cell_resume(context, runtime_opts)

  defp after_ingest_check(_cell, false), do: :ok

  defp after_ingest_check(cell, true) do
    :ok =
      HiveServerElixir.Cells.TerminalEvents.on_cell_error(
        %{workspace_id: cell.workspace_id, cell_id: cell.id},
        "forced_failure_after_ingest"
      )

    {:error, :forced_failure_after_ingest}
  end

  defp apply_template_runtime(:resume, _cell), do: {:ok, %{status: "ready"}}
  defp apply_template_runtime(_mode, cell), do: TemplateRuntime.prepare_cell(cell)

  defp template_ignore_patterns(cell) do
    workspace_root = cell.workspace_root_path || cell.workspace_path

    case TemplateConfig.fetch_template(workspace_root, cell.template_id) do
      {:ok, template} -> Map.get(template, :ignore_patterns, [])
      {:error, _reason} -> []
    end
  end

  defp finalize_async_error(cell_id, reason) do
    case Ash.get(Cell, cell_id) do
      {:ok, cell} ->
        _ =
          HiveServerElixir.Opencode.EventIngestRuntime.stop_stream(%{
            workspace_id: cell.workspace_id,
            cell_id: cell.id
          })

        case Cell.finalize_setup_error(cell, reason) do
          :ok ->
            _ = Events.publish_cell_status(cell.workspace_id, cell.id)
            :ok

          {:ok, _updated_cell} ->
            _ = Events.publish_cell_status(cell.workspace_id, cell.id)
            :ok

          {:error, error} ->
            Logger.warning("Cell provisioning worker failed to finalize error: #{inspect(error)}")
            :ok
        end

      {:error, error} ->
        Logger.warning(
          "Cell provisioning worker could not reload cell #{cell_id}: #{inspect(error)}"
        )

        :ok
    end
  end
end

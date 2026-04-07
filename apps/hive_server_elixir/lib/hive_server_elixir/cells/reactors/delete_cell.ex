defmodule HiveServerElixir.Cells.Reactors.DeleteCell do
  @moduledoc """
  Deletes a cell by stopping ingest first with rollback on downstream failure.
  """

  use Reactor

  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.ProvisioningRuntime
  alias HiveServerElixir.Cells.Reactors.Steps.StopIngestStep
  alias HiveServerElixir.Cells.WorkspaceSnapshot

  input(:cell_id)
  input(:runtime_opts)
  input(:fail_after_stop)

  step :load_cell do
    argument(:cell_id, input(:cell_id))

    run(fn %{cell_id: cell_id}, _context ->
      Ash.get(Cell, cell_id)
    end)
  end

  step :build_ingest_context do
    argument(:cell, result(:load_cell))

    run(fn %{cell: cell}, _context ->
      {:ok, Cell.ingest_context(cell)}
    end)
  end

  step :stop_provisioning do
    argument(:cell, result(:load_cell))

    run(fn %{cell: cell}, _context ->
      case ProvisioningRuntime.stop(cell.id) do
        :ok -> {:ok, :ok}
        {:error, :not_found} -> {:ok, :ok}
      end
    end)
  end

  step :stop_ingest, StopIngestStep do
    argument(:context, result(:build_ingest_context))
    argument(:_provisioning, result(:stop_provisioning))
    argument(:runtime_opts, input(:runtime_opts))
  end

  step :after_stop_check do
    argument(:_stopped, result(:stop_ingest))
    argument(:fail_after_stop, input(:fail_after_stop))

    run(fn %{fail_after_stop: fail_after_stop}, _context ->
      if fail_after_stop do
        {:error, :forced_failure_after_stop}
      else
        {:ok, :ok}
      end
    end)
  end

  step :destroy_cell do
    argument(:cell, result(:load_cell))
    argument(:_check, result(:after_stop_check))

    run(fn %{cell: cell}, _context ->
      case Ash.destroy(cell) do
        :ok -> {:ok, cell}
        {:ok, destroyed_cell} -> {:ok, destroyed_cell}
        {:error, reason} -> {:error, reason}
      end
    end)
  end

  step :cleanup_workspace do
    argument(:cell, result(:destroy_cell))

    run(fn %{cell: cell}, _context ->
      :ok = WorkspaceSnapshot.remove_cell_workspace(cell.workspace_path)
      {:ok, cell}
    end)
  end

  return(:cleanup_workspace)
end

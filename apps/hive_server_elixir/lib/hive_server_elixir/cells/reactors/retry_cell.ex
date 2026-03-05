defmodule HiveServerElixir.Cells.Reactors.RetryCell do
  @moduledoc """
  Retries a failed cell by restarting ingest and marking it ready.
  """

  use Reactor

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Reactors.Steps.RetryIngestStep

  input(:cell_id)
  input(:runtime_opts)
  input(:fail_after_ingest)

  step :load_cell do
    argument(:cell_id, input(:cell_id))

    run(fn %{cell_id: cell_id}, _context ->
      Ash.get(Cell, cell_id, domain: Cells)
    end)
  end

  step :build_ingest_context do
    argument(:cell, result(:load_cell))

    run(fn %{cell: cell}, _context ->
      {:ok, %{workspace_id: cell.workspace_id, cell_id: cell.id}}
    end)
  end

  step :restart_ingest, RetryIngestStep do
    argument(:context, result(:build_ingest_context))
    argument(:runtime_opts, input(:runtime_opts))
  end

  step :after_ingest_check do
    argument(:_started, result(:restart_ingest))
    argument(:fail_after_ingest, input(:fail_after_ingest))

    run(fn %{fail_after_ingest: fail_after_ingest}, _context ->
      if fail_after_ingest do
        {:error, :forced_failure_after_ingest}
      else
        {:ok, :ok}
      end
    end)
  end

  step :mark_ready do
    argument(:cell, result(:load_cell))
    argument(:_check, result(:after_ingest_check))

    run(fn %{cell: cell}, _context ->
      Ash.update(cell, %{status: "ready"}, domain: Cells)
    end)
  end

  return(:mark_ready)
end

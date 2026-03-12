defmodule HiveServerElixir.Cells.Reactors.ResumeCell do
  @moduledoc """
  Resumes a cell by ensuring ingest is running and marking it ready.
  """

  use Reactor

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Reactors.Steps.ResumeIngestStep
  alias HiveServerElixir.Cells.TerminalEvents

  input(:cell_id)
  input(:runtime_opts)
  input(:fail_after_ingest)

  step :load_cell do
    argument(:cell_id, input(:cell_id))

    run(fn %{cell_id: cell_id}, _context ->
      Ash.get(Cell, cell_id, domain: Cells)
    end)
  end

  step :prepare_resume_state do
    argument(:cell, result(:load_cell))

    run(fn %{cell: cell}, _context ->
      cell
      |> Ash.Changeset.for_update(:prepare_setup_attempt, %{})
      |> Ash.update(domain: Cells)
    end)
  end

  step :build_ingest_context do
    argument(:cell, result(:prepare_resume_state))

    run(fn %{cell: cell}, _context ->
      {:ok, Cell.ingest_context(cell)}
    end)
  end

  step :restart_ingest, ResumeIngestStep do
    argument(:context, result(:build_ingest_context))
    argument(:runtime_opts, input(:runtime_opts))
  end

  step :after_ingest_check do
    argument(:_started, result(:restart_ingest))
    argument(:cell, result(:prepare_resume_state))
    argument(:fail_after_ingest, input(:fail_after_ingest))

    run(fn %{cell: cell, fail_after_ingest: fail_after_ingest}, _context ->
      if fail_after_ingest do
        :ok =
          TerminalEvents.on_cell_error(
            %{workspace_id: cell.workspace_id, cell_id: cell.id},
            "forced_failure_after_ingest"
          )

        {:error, :forced_failure_after_ingest}
      else
        {:ok, :ok}
      end
    end)

    compensate(fn reason, %{cell: cell}, _context ->
      Cell.finalize_setup_error(cell, reason)
    end)
  end

  step :mark_ready do
    argument(:cell, result(:prepare_resume_state))
    argument(:_check, result(:after_ingest_check))

    run(fn %{cell: cell}, _context ->
      with {:ok, updated_cell} <- Cell.finalize_template_runtime(cell, %{status: "ready"}) do
        :ok = Cell.emit_terminal_state(updated_cell)
        {:ok, updated_cell}
      end
    end)
  end

  return(:mark_ready)
end

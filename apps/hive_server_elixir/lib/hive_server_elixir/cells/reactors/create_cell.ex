defmodule HiveServerElixir.Cells.Reactors.CreateCell do
  @moduledoc """
  Creates a cell record and starts ingest with rollback if downstream checks fail.
  """

  use Reactor

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.TerminalEvents
  alias HiveServerElixir.Cells.Reactors.Steps.StartIngestStep

  input(:workspace_id)
  input(:description)
  input(:runtime_opts)
  input(:fail_after_ingest)

  step :create_cell do
    argument(:workspace_id, input(:workspace_id))
    argument(:description, input(:description))

    run(fn %{workspace_id: workspace_id, description: description}, _context ->
      Ash.create(
        Cell,
        %{workspace_id: workspace_id, description: description, status: "provisioning"},
        domain: Cells
      )
    end)
  end

  step :build_ingest_context do
    argument(:cell, result(:create_cell))

    run(fn %{cell: cell}, _context ->
      {:ok, %{workspace_id: cell.workspace_id, cell_id: cell.id}}
    end)
  end

  step :start_ingest, StartIngestStep do
    argument(:context, result(:build_ingest_context))
    argument(:runtime_opts, input(:runtime_opts))
  end

  step :after_ingest_check do
    argument(:_started, result(:start_ingest))
    argument(:cell, result(:create_cell))
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
  end

  step :mark_ready do
    argument(:cell, result(:create_cell))
    argument(:_check, result(:after_ingest_check))

    run(fn %{cell: cell}, _context ->
      case Ash.update(cell, %{status: "ready"}, domain: Cells) do
        {:ok, updated_cell} ->
          :ok =
            TerminalEvents.on_cell_ready(%{
              workspace_id: updated_cell.workspace_id,
              cell_id: updated_cell.id
            })

          {:ok, updated_cell}

        {:error, error} ->
          {:error, error}
      end
    end)
  end

  return(:mark_ready)
end

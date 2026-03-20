defmodule HiveServerElixir.Cells.Reactors.RetryCell do
  @moduledoc """
  Persists retry state before detached background provisioning begins.
  """

  use Reactor

  alias HiveServerElixir.Cells.Cell

  input(:cell_id)

  step :load_cell do
    argument(:cell_id, input(:cell_id))

    run(fn %{cell_id: cell_id}, _context ->
      Ash.get(Cell, cell_id)
    end)
  end

  step :prepare_retry_state do
    argument(:cell, result(:load_cell))

    run(fn %{cell: cell}, _context ->
      cell
      |> Ash.Changeset.for_update(:prepare_setup_attempt, %{})
      |> Ash.update()
    end)
  end

  return(:prepare_retry_state)
end

defmodule HiveServerElixir.Cells.Reactors.Steps.RetryIngestStep do
  @moduledoc false

  use Reactor.Step

  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Lifecycle

  @impl true
  def run(arguments, _context, _options) do
    case Lifecycle.on_cell_retry(arguments.context, arguments.runtime_opts) do
      {:ok, pid} -> {:ok, %{context: arguments.context, pid: pid}}
      {:error, reason} -> {:error, reason}
    end
  end

  @impl true
  def compensate(reason, arguments, _context, _options) do
    Cell.finalize_setup_error(arguments.context.cell_id, reason)
  end

  @impl true
  def undo(_result, arguments, _context, _options) do
    Lifecycle.on_cell_delete(arguments.context)
  end
end

defmodule HiveServerElixir.Cells.Reactors.Steps.ResumeIngestStep do
  @moduledoc false

  use Reactor.Step

  alias HiveServerElixir.Cells.Lifecycle
  alias HiveServerElixir.Cells.SetupAttempt

  @impl true
  def run(arguments, _context, _options) do
    case Lifecycle.on_cell_resume(arguments.context, arguments.runtime_opts) do
      {:ok, pid} -> {:ok, %{context: arguments.context, pid: pid}}
      {:error, reason} -> {:error, reason}
    end
  end

  @impl true
  def compensate(reason, arguments, _context, _options) do
    SetupAttempt.finalize_error(arguments.context.cell_id, reason)
  end

  @impl true
  def undo(_result, arguments, _context, _options) do
    Lifecycle.on_cell_delete(arguments.context)
  end
end

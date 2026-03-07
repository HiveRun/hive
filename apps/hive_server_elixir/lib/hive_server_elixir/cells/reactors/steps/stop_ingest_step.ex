defmodule HiveServerElixir.Cells.Reactors.Steps.StopIngestStep do
  @moduledoc false

  use Reactor.Step

  alias HiveServerElixir.Cells.Lifecycle

  @impl true
  def run(arguments, _context, _options) do
    case Lifecycle.on_cell_delete(arguments.context) do
      :ok -> {:ok, %{context: arguments.context}}
    end
  end

  @impl true
  def undo(_result, arguments, _context, _options) do
    case Lifecycle.on_cell_create(arguments.context, arguments.runtime_opts) do
      {:ok, _pid} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end
end

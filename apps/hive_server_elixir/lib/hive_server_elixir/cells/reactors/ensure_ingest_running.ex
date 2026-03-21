defmodule HiveServerElixir.Cells.Reactors.EnsureIngestRunning do
  @moduledoc """
  Reactor workflow that starts cell ingest and compensates by stopping it on downstream failure.
  """

  use Reactor

  alias HiveServerElixir.Cells.Reactors.Steps.StartIngestStep

  input(:context)
  input(:runtime_opts)
  input(:fail_after_start)

  step :start_ingest, StartIngestStep do
    argument(:context, input(:context))
    argument(:runtime_opts, input(:runtime_opts))
  end

  step :post_start_check do
    argument(:fail_after_start, input(:fail_after_start))

    run(fn %{fail_after_start: fail_after_start}, _context ->
      if fail_after_start do
        {:error, :forced_failure}
      else
        {:ok, :ok}
      end
    end)
  end

  return(:start_ingest)
end

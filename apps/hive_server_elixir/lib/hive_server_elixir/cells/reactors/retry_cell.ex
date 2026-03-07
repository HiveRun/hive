defmodule HiveServerElixir.Cells.Reactors.RetryCell do
  @moduledoc """
  Retries a failed cell by restarting ingest and re-running template orchestration.
  """

  use Reactor

  import Ash.Expr
  require Ash.Query

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Provisioning
  alias HiveServerElixir.Cells.Reactors.Steps.RetryIngestStep
  alias HiveServerElixir.Cells.TemplateRuntime
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

  step :prepare_retry_state do
    argument(:cell, result(:load_cell))

    run(fn %{cell: cell}, _context ->
      started_at = DateTime.utc_now() |> DateTime.truncate(:second)

      with {:ok, updated_cell} <-
             Ash.update(cell, %{status: "provisioning", last_setup_error: nil}, domain: Cells),
           :ok <- bump_provisioning_state(updated_cell.id, started_at) do
        {:ok, updated_cell}
      end
    end)
  end

  step :build_ingest_context do
    argument(:cell, result(:prepare_retry_state))

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
    argument(:cell, result(:prepare_retry_state))
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

  step :apply_template_runtime do
    argument(:cell, result(:prepare_retry_state))
    argument(:_check, result(:after_ingest_check))

    run(fn %{cell: cell}, _context ->
      TemplateRuntime.prepare_cell(cell)
    end)
  end

  step :finalize_cell do
    argument(:cell, result(:prepare_retry_state))
    argument(:template_runtime, result(:apply_template_runtime))

    run(fn %{cell: cell, template_runtime: template_runtime}, _context ->
      finished_at = DateTime.utc_now() |> DateTime.truncate(:second)

      with {:ok, updated_cell} <-
             Ash.update(
               cell,
               %{
                 status: template_runtime.status,
                 last_setup_error: template_runtime.last_setup_error
               },
               domain: Cells
             ),
           :ok <- finalize_provisioning_state(updated_cell.id, finished_at) do
        finalize_terminal_state(updated_cell)
        {:ok, updated_cell}
      end
    end)
  end

  return(:finalize_cell)

  defp bump_provisioning_state(cell_id, started_at) do
    case provisioning_for_cell(cell_id) do
      %Provisioning{} = provisioning ->
        attrs = %{
          attempt_count: max(provisioning.attempt_count || 0, 0) + 1,
          started_at: started_at,
          finished_at: nil
        }

        case Ash.update(provisioning, attrs, domain: Cells) do
          {:ok, _updated} -> :ok
          {:error, error} -> {:error, error}
        end

      nil ->
        case Ash.create(
               Provisioning,
               %{cell_id: cell_id, attempt_count: 1, started_at: started_at},
               domain: Cells
             ) do
          {:ok, _created} -> :ok
          {:error, error} -> {:error, error}
        end
    end
  end

  defp finalize_provisioning_state(cell_id, finished_at) do
    case provisioning_for_cell(cell_id) do
      %Provisioning{} = provisioning ->
        case Ash.update(provisioning, %{finished_at: finished_at}, domain: Cells) do
          {:ok, _updated} -> :ok
          {:error, error} -> {:error, error}
        end

      nil ->
        :ok
    end
  end

  defp provisioning_for_cell(cell_id) do
    Provisioning
    |> Ash.Query.filter(expr(cell_id == ^cell_id))
    |> Ash.read_one!(domain: Cells)
  end

  defp finalize_terminal_state(%Cell{status: "ready"} = cell) do
    TerminalEvents.on_cell_ready(%{workspace_id: cell.workspace_id, cell_id: cell.id})
  end

  defp finalize_terminal_state(%Cell{status: "error", last_setup_error: message} = cell)
       when is_binary(message) and message != "" do
    TerminalEvents.on_cell_error(%{workspace_id: cell.workspace_id, cell_id: cell.id}, message)
  end

  defp finalize_terminal_state(%Cell{}), do: :ok
end

defmodule HiveServerElixir.Cells.Reactors.RetryCell do
  @moduledoc """
  Retries a failed cell by restarting ingest and re-running template orchestration.
  """

  use Reactor

  import Ash.Expr
  require Ash.Query

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.AgentSessionProjection
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.CellStatus
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
      with {:ok, updated_cell} <-
             Ash.update(cell, %{}, action: :begin_provisioning, domain: Cells),
           :ok <- begin_provisioning_attempt(updated_cell.id),
           :ok <- AgentSessionProjection.ensure_resume_projection(updated_cell) do
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
      with {:ok, updated_cell} <- finalize_cell_status(cell, template_runtime),
           :ok <- finalize_provisioning_state(updated_cell.id) do
        finalize_terminal_state(updated_cell)
        {:ok, updated_cell}
      end
    end)
  end

  return(:finalize_cell)

  defp begin_provisioning_attempt(cell_id) do
    case provisioning_for_cell(cell_id) do
      %Provisioning{} = provisioning ->
        case Ash.update(provisioning, %{}, action: :begin_attempt, domain: Cells) do
          {:ok, _updated} -> :ok
          {:error, error} -> {:error, error}
        end

      nil ->
        case Ash.create(
               Provisioning,
               %{cell_id: cell_id},
               action: :begin_attempt_record,
               domain: Cells
             ) do
          {:ok, _created} -> :ok
          {:error, error} -> {:error, error}
        end
    end
  end

  defp finalize_provisioning_state(cell_id) do
    case provisioning_for_cell(cell_id) do
      %Provisioning{} = provisioning ->
        case Ash.update(provisioning, %{}, action: :finish_attempt, domain: Cells) do
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

  defp finalize_cell_status(cell, %{status: "ready"}) do
    Ash.update(cell, %{}, action: :mark_ready, domain: Cells)
  end

  defp finalize_cell_status(cell, %{status: "error", last_setup_error: last_setup_error}) do
    Ash.update(cell, %{last_setup_error: last_setup_error}, action: :mark_error, domain: Cells)
  end

  defp finalize_cell_status(cell, %{status: status, last_setup_error: last_setup_error}) do
    Ash.update(
      cell,
      %{status: status, last_setup_error: last_setup_error},
      domain: Cells
    )
  end

  defp finalize_terminal_state(%Cell{} = cell) do
    cond do
      CellStatus.ready?(cell) ->
        TerminalEvents.on_cell_ready(%{workspace_id: cell.workspace_id, cell_id: cell.id})

      CellStatus.error?(cell) and is_binary(cell.last_setup_error) and cell.last_setup_error != "" ->
        TerminalEvents.on_cell_error(
          %{workspace_id: cell.workspace_id, cell_id: cell.id},
          cell.last_setup_error
        )

      true ->
        :ok
    end
  end
end

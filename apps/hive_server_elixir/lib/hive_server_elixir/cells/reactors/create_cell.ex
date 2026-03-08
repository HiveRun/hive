defmodule HiveServerElixir.Cells.Reactors.CreateCell do
  @moduledoc """
  Creates a cell record and starts ingest with rollback if downstream checks fail.
  """

  use Reactor

  import Ash.Expr
  require Ash.Query

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.AgentSession
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.CellStatus
  alias HiveServerElixir.Cells.Provisioning
  alias HiveServerElixir.Cells.Reactors.Steps.StartIngestStep
  alias HiveServerElixir.Cells.TemplateRuntime
  alias HiveServerElixir.Cells.TerminalEvents
  alias HiveServerElixir.Cells.WorkspaceSnapshot

  input(:workspace_id)
  input(:name)
  input(:description)
  input(:template_id)
  input(:start_mode)
  input(:workspace_root_path)
  input(:workspace_path)
  input(:runtime_opts)
  input(:fail_after_ingest)

  step :create_cell do
    argument(:workspace_id, input(:workspace_id))
    argument(:name, input(:name))
    argument(:description, input(:description))
    argument(:template_id, input(:template_id))
    argument(:workspace_root_path, input(:workspace_root_path))
    argument(:workspace_path, input(:workspace_path))

    run(fn
      %{
        workspace_id: workspace_id,
        name: name,
        description: description,
        template_id: template_id,
        workspace_root_path: workspace_root_path,
        workspace_path: workspace_path
      },
      _context ->
        Ash.create(
          Cell,
          %{
            workspace_id: workspace_id,
            name: name,
            description: description,
            template_id: template_id,
            workspace_root_path: workspace_root_path,
            workspace_path: workspace_path,
            status: "provisioning"
          },
          domain: Cells
        )
    end)
  end

  step :prepare_workspace do
    argument(:cell, result(:create_cell))

    run(fn %{cell: cell}, _context ->
      maybe_prepare_workspace(cell)
    end)
  end

  step :initialize_runtime_records do
    argument(:cell, result(:prepare_workspace))
    argument(:start_mode, input(:start_mode))

    run(fn %{cell: cell, start_mode: start_mode}, _context ->
      mode = normalize_start_mode(start_mode)
      session_id = cell.opencode_session_id || Ash.UUID.generate()

      with {:ok, updated_cell} <-
             Ash.update(
               cell,
               %{opencode_session_id: session_id, resume_agent_session_on_startup: true},
               domain: Cells
             ),
           {:ok, _provisioning} <-
             Ash.create(
               Provisioning,
               %{
                 cell_id: updated_cell.id,
                 start_mode: mode
               },
               action: :begin_attempt_record,
               domain: Cells
             ),
           {:ok, _agent_session} <-
             Ash.create(
               AgentSession,
               %{
                 cell_id: updated_cell.id,
                 session_id: session_id,
                 start_mode: mode,
                 current_mode: mode,
                 resume_on_startup: true
               },
               action: :begin_session,
               domain: Cells
             ) do
        {:ok, updated_cell}
      end
    end)
  end

  step :build_ingest_context do
    argument(:cell, result(:initialize_runtime_records))

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
    argument(:cell, result(:initialize_runtime_records))
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
    argument(:cell, result(:initialize_runtime_records))
    argument(:_check, result(:after_ingest_check))

    run(fn %{cell: cell}, _context ->
      TemplateRuntime.prepare_cell(cell)
    end)
  end

  step :finalize_cell do
    argument(:cell, result(:initialize_runtime_records))
    argument(:template_runtime, result(:apply_template_runtime))

    run(fn %{cell: cell, template_runtime: template_runtime}, _context ->
      with {:ok, updated_cell} <- finalize_cell_status(cell, template_runtime),
           :ok <- finish_provisioning_state(updated_cell.id) do
        finalize_terminal_state(updated_cell)
        {:ok, updated_cell}
      end
    end)
  end

  return(:finalize_cell)

  defp maybe_prepare_workspace(%Cell{} = cell) do
    source_root = cell.workspace_root_path || cell.workspace_path

    if is_binary(source_root) and File.dir?(source_root) do
      with {:ok, workspace_path} <- WorkspaceSnapshot.ensure_cell_workspace(cell.id, source_root),
           {:ok, updated_cell} <-
             Ash.update(cell, %{workspace_path: workspace_path}, domain: Cells) do
        {:ok, updated_cell}
      end
    else
      {:ok, cell}
    end
  end

  defp finish_provisioning_state(cell_id) do
    provisioning =
      Provisioning
      |> Ash.Query.filter(expr(cell_id == ^cell_id))
      |> Ash.read_one!(domain: Cells)

    case provisioning do
      %Provisioning{} = record ->
        case Ash.update(record, %{}, action: :finish_attempt, domain: Cells) do
          {:ok, _updated} -> :ok
          {:error, error} -> {:error, error}
        end

      nil ->
        :ok
    end
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

  defp normalize_start_mode("build"), do: "build"
  defp normalize_start_mode(_mode), do: "plan"
end

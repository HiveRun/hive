defmodule HiveServerElixir.Cells.Reactors.CreateCell do
  @moduledoc """
  Persists the initial provisioning cell state before detached background work begins.
  """

  use Reactor

  alias HiveServerElixir.Cells.Cell

  input(:workspace_id)
  input(:name)
  input(:description)
  input(:template_id)
  input(:start_mode)
  input(:workspace_root_path)
  input(:workspace_path)

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
        Ash.create(Cell, %{
          workspace_id: workspace_id,
          name: name,
          description: description,
          template_id: template_id,
          workspace_root_path: workspace_root_path,
          workspace_path: workspace_path,
          status: "provisioning"
        })
    end)
  end

  step :prepare_workspace do
    argument(:cell, result(:create_cell))

    run(fn %{cell: cell}, _context ->
      {:ok, cell}
    end)
  end

  step :initialize_runtime_records do
    argument(:cell, result(:prepare_workspace))
    argument(:start_mode, input(:start_mode))

    run(fn %{cell: cell, start_mode: start_mode}, _context ->
      mode = normalize_start_mode(start_mode)
      session_id = cell.opencode_session_id || Ash.UUID.generate()

      cell
      |> Ash.Changeset.for_update(
        :prepare_setup_attempt,
        %{opencode_session_id: session_id, start_mode: mode}
      )
      |> Ash.update()
    end)
  end

  return(:initialize_runtime_records)

  defp normalize_start_mode("build"), do: "build"
  defp normalize_start_mode(_mode), do: "plan"
end

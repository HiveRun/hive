defmodule HiveServerElixirWeb.CellsSerializer do
  @moduledoc false

  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.TerminalRuntime
  alias HiveServerElixir.Cells.Workspace

  @spec serialize_cell(Cell.t(), keyword()) :: map()
  def serialize_cell(%Cell{} = cell, opts) do
    workspace = Keyword.get(opts, :workspace)
    include_setup_log = Keyword.get(opts, :include_setup_log, false)

    workspace_path =
      if match?(%Workspace{}, workspace) and is_binary(workspace.path),
        do: workspace.path,
        else: ""

    setup_payload = maybe_setup_log_payload(cell.id, include_setup_log)

    Cell.transport_payload(cell, workspace_path: workspace_path)
    |> Map.merge(setup_payload)
    |> maybe_drop_nil("lastSetupError")
    |> maybe_drop_nil("branchName")
    |> maybe_drop_nil("baseCommit")
  end

  defp maybe_setup_log_payload(_cell_id, false), do: %{}

  defp maybe_setup_log_payload(cell_id, true) do
    output = TerminalRuntime.read_setup_output(cell_id)
    setup_log = output |> Enum.join("") |> String.trim()

    %{
      setupLog: if(setup_log == "", do: nil, else: setup_log),
      setupLogPath: nil
    }
  end

  defp maybe_drop_nil(map, key) do
    case Map.get(map, key) do
      nil -> Map.delete(map, key)
      _value -> map
    end
  end
end

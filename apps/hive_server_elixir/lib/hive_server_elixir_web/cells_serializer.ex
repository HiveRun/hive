defmodule HiveServerElixirWeb.CellsSerializer do
  @moduledoc false

  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.CellStatus
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

    %{
      id: cell.id,
      name: cell.name,
      workspaceId: cell.workspace_id,
      description: cell.description,
      templateId: cell.template_id,
      workspaceRootPath: present_or_fallback(cell.workspace_root_path, workspace_path),
      workspacePath: present_or_fallback(cell.workspace_path, workspace_path),
      opencodeSessionId: cell.opencode_session_id,
      opencodeCommand: build_opencode_command(cell.workspace_path, cell.opencode_session_id),
      createdAt: maybe_to_iso8601(cell.inserted_at),
      status: CellStatus.present(cell.status),
      lastSetupError: cell.last_setup_error,
      branchName: cell.branch_name,
      baseCommit: cell.base_commit,
      updatedAt: maybe_to_iso8601(cell.updated_at)
    }
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

  defp present_or_fallback(value, _fallback) when is_binary(value) and byte_size(value) > 0,
    do: value

  defp present_or_fallback(_value, fallback), do: fallback

  defp build_opencode_command(workspace_path, session_id)
       when is_binary(workspace_path) and workspace_path != "" and is_binary(session_id) and
              session_id != "" do
    "opencode \"" <> workspace_path <> "\" --session \"" <> session_id <> "\""
  end

  defp build_opencode_command(_workspace_path, _session_id), do: nil

  defp maybe_drop_nil(map, key) do
    case Map.get(map, key) do
      nil -> Map.delete(map, key)
      _value -> map
    end
  end

  defp maybe_to_iso8601(%DateTime{} = value), do: DateTime.to_iso8601(value)
  defp maybe_to_iso8601(%NaiveDateTime{} = value), do: NaiveDateTime.to_iso8601(value)
  defp maybe_to_iso8601(value) when is_binary(value), do: value
  defp maybe_to_iso8601(_value), do: nil
end

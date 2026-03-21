defmodule HiveServerElixir.Cells.WorkspaceSnapshot do
  @moduledoc false

  alias HiveServerElixir.Workspaces.PathPolicy

  @spec ensure_cell_workspace(String.t(), String.t()) :: {:ok, String.t()} | {:error, String.t()}
  def ensure_cell_workspace(cell_id, source_root)
      when is_binary(cell_id) and is_binary(source_root) do
    with true <- File.dir?(source_root),
         {:ok, cells_root} <- ensure_cells_root(),
         destination <- Path.join(cells_root, cell_id),
         :ok <- remove_existing_workspace(destination),
         :ok <- copy_workspace(source_root, destination) do
      {:ok, destination}
    else
      false -> {:error, "Workspace root does not exist: #{source_root}"}
      {:error, reason} -> {:error, reason}
    end
  end

  def ensure_cell_workspace(_cell_id, source_root),
    do: {:error, "Workspace root does not exist: #{inspect(source_root)}"}

  @spec remove_cell_workspace(String.t()) :: :ok
  def remove_cell_workspace(path) when is_binary(path) do
    if PathPolicy.cell_workspace_path?(path) do
      _ = File.rm_rf(path)
    end

    :ok
  end

  def remove_cell_workspace(_path), do: :ok

  defp ensure_cells_root do
    cells_root = hive_home() |> Path.join("cells") |> Path.expand()

    case File.mkdir_p(cells_root) do
      :ok -> {:ok, cells_root}
      {:error, reason} -> {:error, "Failed to prepare cell workspace root: #{inspect(reason)}"}
    end
  end

  defp remove_existing_workspace(path) do
    case File.rm_rf(path) do
      {:ok, _files} -> :ok
      {:error, reason, _path} -> {:error, "Failed to reset cell workspace: #{inspect(reason)}"}
    end
  end

  defp copy_workspace(source_root, destination) do
    case File.cp_r(source_root, destination) do
      {:ok, _files} -> :ok
      {:error, reason, _path} -> {:error, "Failed to copy workspace: #{inspect(reason)}"}
    end
  end

  defp hive_home do
    System.get_env("HIVE_HOME") || Path.join(System.user_home!(), ".hive")
  end
end

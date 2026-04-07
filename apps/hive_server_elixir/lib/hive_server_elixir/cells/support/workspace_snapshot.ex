defmodule HiveServerElixir.Cells.WorkspaceSnapshot do
  @moduledoc false

  alias HiveServerElixir.Workspaces.PathPolicy

  @always_ignored_patterns [".hive/**"]

  @spec ensure_cell_workspace(String.t(), String.t()) :: {:ok, String.t()} | {:error, String.t()}
  def ensure_cell_workspace(cell_id, source_root)
      when is_binary(cell_id) and is_binary(source_root) do
    ensure_cell_workspace(cell_id, source_root, [])
  end

  @spec ensure_cell_workspace(String.t(), String.t(), [String.t()]) ::
          {:ok, String.t()} | {:error, String.t()}
  def ensure_cell_workspace(cell_id, source_root, ignore_patterns)
      when is_binary(cell_id) and is_binary(source_root) do
    with true <- File.dir?(source_root),
         {:ok, cells_root} <- ensure_cells_root(),
         destination <- Path.join(cells_root, cell_id),
         :ok <- remove_existing_workspace(destination),
         :ok <- copy_workspace(source_root, destination, ignore_patterns) do
      {:ok, destination}
    else
      false -> {:error, "Workspace root does not exist: #{source_root}"}
      {:error, reason} -> {:error, reason}
    end
  end

  def ensure_cell_workspace(_cell_id, source_root, _ignore_patterns),
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

  defp copy_workspace(source_root, destination, ignore_patterns) do
    matcher = build_ignore_matcher(ignore_patterns)

    with :ok <- File.mkdir_p(destination),
         :ok <- copy_directory_contents(source_root, destination, source_root, matcher) do
      :ok
    else
      {:error, reason} -> {:error, "Failed to copy workspace: #{inspect(reason)}"}
    end
  end

  defp copy_directory_contents(source_root, destination_root, workspace_root, ignore_matcher) do
    case File.ls(source_root) do
      {:ok, entries} ->
        Enum.reduce_while(entries, :ok, fn entry, :ok ->
          source_path = Path.join(source_root, entry)
          destination_path = Path.join(destination_root, entry)
          relative_path = relative_path(source_path, workspace_root)

          if ignore_matcher.(relative_path) do
            {:cont, :ok}
          else
            case copy_entry(source_path, destination_path, workspace_root, ignore_matcher) do
              :ok -> {:cont, :ok}
              {:error, _reason} = error -> {:halt, error}
            end
          end
        end)

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp copy_entry(source_path, destination_path, workspace_root, ignore_matcher) do
    case File.lstat(source_path) do
      {:ok, %File.Stat{type: :directory}} ->
        with :ok <- File.mkdir_p(destination_path) do
          copy_directory_contents(source_path, destination_path, workspace_root, ignore_matcher)
        end

      {:ok, %File.Stat{type: :symlink}} ->
        with {:ok, target} <- File.read_link(source_path),
             :ok <- File.ln_s(target, destination_path) do
          :ok
        end

      {:ok, _stat} ->
        File.cp(source_path, destination_path)

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp build_ignore_matcher(ignore_patterns) do
    compiled_patterns =
      (@always_ignored_patterns ++ ignore_patterns)
      |> Enum.uniq()
      |> Enum.map(&compile_ignore_pattern/1)

    fn relative_path ->
      Enum.any?(compiled_patterns, &Regex.match?(&1, relative_path))
    end
  end

  defp compile_ignore_pattern(pattern) do
    normalized_pattern =
      pattern
      |> String.trim()
      |> String.replace("\\", "/")
      |> String.replace_prefix("./", "")
      |> String.trim_leading("/")

    if String.ends_with?(normalized_pattern, "/**") do
      prefix = String.trim_trailing(normalized_pattern, "/**")
      Regex.compile!("^#{Regex.escape(prefix)}(?:/.*)?$")
    else
      normalized_pattern
      |> Regex.escape()
      |> String.replace("\\*\\*", ".*")
      |> String.replace("\\*", "[^/]*")
      |> String.replace("\\?", "[^/]")
      |> then(&Regex.compile!("^#{&1}$"))
    end
  end

  defp relative_path(source_path, workspace_root) do
    source_path
    |> Path.relative_to(workspace_root)
    |> String.replace("\\", "/")
  end

  defp hive_home do
    System.get_env("HIVE_HOME") || Path.join(System.user_home!(), ".hive")
  end
end

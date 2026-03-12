defmodule HiveServerElixir.Workspaces.PathPolicy do
  @moduledoc false

  @hive_config_filename "hive.config.json"
  @fallback_directory "hive"

  @spec default_browse_root() :: String.t()
  def default_browse_root do
    case System.get_env("HIVE_BROWSE_ROOT") do
      value when is_binary(value) and value != "" -> Path.expand(value)
      _other -> resolve_startup_workspace_root() || System.user_home!() || "."
    end
  end

  @spec resolve_startup_workspace_root() :: String.t() | nil
  def resolve_startup_workspace_root do
    base_root = resolve_base_workspace_root()
    candidate = find_config_root(base_root)

    if has_config_file?(candidate) and File.dir?(candidate) and
         not cell_workspace_path?(candidate) do
      candidate
    else
      nil
    end
  end

  @spec validate_registration_path(String.t()) :: :ok | {:error, String.t()}
  def validate_registration_path(path) when is_binary(path) do
    cond do
      not File.dir?(path) ->
        {:error, "Workspace path does not exist: #{path}"}

      cell_workspace_path?(path) ->
        {:error, "Cell worktrees cannot be registered as workspaces"}

      not has_config_file?(path) ->
        {:error, "Hive config not found in #{path}. Add #{@hive_config_filename}."}

      true ->
        :ok
    end
  end

  def validate_registration_path(_path), do: {:error, "Workspace path is required"}

  @spec derive_label_from_path(String.t()) :: String.t()
  def derive_label_from_path(path) when is_binary(path) do
    case Path.basename(path) do
      "." -> path
      "" -> path
      value -> value
    end
  end

  @spec has_config_file?(String.t()) :: boolean
  def has_config_file?(directory) when is_binary(directory) do
    File.exists?(Path.join(directory, @hive_config_filename))
  end

  def has_config_file?(_directory), do: false

  @spec cell_workspace_path?(String.t()) :: boolean
  def cell_workspace_path?(path) when is_binary(path) do
    cells_root = cells_root()
    normalized_path = Path.expand(path)

    normalized_path == cells_root || String.starts_with?(normalized_path, cells_root <> "/")
  end

  def cell_workspace_path?(_path), do: false

  @spec parent_path(String.t()) :: String.t() | nil
  def parent_path(path) when is_binary(path) do
    parent = Path.dirname(path)
    if parent == path, do: nil, else: parent
  end

  def parent_path(_path), do: nil

  defp resolve_base_workspace_root do
    case System.get_env("HIVE_WORKSPACE_ROOT") do
      value when is_binary(value) and value != "" ->
        Path.expand(value)

      _other ->
        current_dir = File.cwd!()

        case String.split(current_dir, "/apps/", parts: 2) do
          [root, _rest] when root != "" -> root
          _other -> current_dir
        end
    end
  end

  defp find_config_root(base_root) do
    normalized_root = Path.expand(base_root)

    cond do
      has_config_file?(normalized_root) ->
        normalized_root

      has_config_file?(Path.join(normalized_root, @fallback_directory)) ->
        Path.join(normalized_root, @fallback_directory)

      true ->
        normalized_root
    end
  end

  defp cells_root do
    (System.get_env("HIVE_HOME") || Path.join(System.user_home!(), ".hive"))
    |> Path.join("cells")
    |> Path.expand()
  end
end

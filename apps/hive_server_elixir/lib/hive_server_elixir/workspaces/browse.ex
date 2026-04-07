defmodule HiveServerElixir.Workspaces.Browse do
  @moduledoc false

  alias HiveServerElixir.Workspaces.PathPolicy

  @spec list_directories(String.t() | nil, String.t() | nil) ::
          {:ok, %{path: String.t(), parentPath: String.t() | nil, directories: [map()]}}
          | {:error, String.t()}
  def list_directories(path, filter) do
    target_path = normalize_browse_path(path)
    normalized_filter = normalize_filter(filter)

    with :ok <- validate_directory(target_path),
         {:ok, entries} <- File.ls(target_path) do
      directories =
        entries
        |> Enum.sort()
        |> Enum.map(&build_browse_entry(target_path, &1, normalized_filter))
        |> Enum.filter(&is_map/1)

      {:ok,
       %{
         path: target_path,
         parentPath: PathPolicy.parent_path(target_path),
         directories: directories
       }}
    else
      {:error, reason} -> {:error, directory_error(target_path, reason)}
    end
  end

  defp validate_directory(path) do
    case File.stat(path) do
      {:ok, %File.Stat{type: :directory}} -> :ok
      {:ok, _stat} -> {:error, :not_directory}
      {:error, reason} -> {:error, reason}
    end
  end

  defp normalize_browse_path(nil), do: PathPolicy.default_browse_root()

  defp normalize_browse_path(path) when is_binary(path) do
    if String.trim(path) == "" do
      PathPolicy.default_browse_root()
    else
      Path.expand(path)
    end
  end

  defp normalize_browse_path(_path), do: PathPolicy.default_browse_root()

  defp normalize_filter(nil), do: nil

  defp normalize_filter(value) when is_binary(value) do
    trimmed = value |> String.trim() |> String.downcase()
    if trimmed == "", do: nil, else: trimmed
  end

  defp normalize_filter(_value), do: nil

  defp build_browse_entry(target_path, name, filter) do
    full_path = Path.join(target_path, name)

    with true <- directory_filter_match?(name, filter),
         false <- PathPolicy.cell_workspace_path?(full_path),
         {:ok, %File.Stat{type: :directory}} <- File.stat(full_path) do
      %{
        name: name,
        path: full_path,
        hasConfig: PathPolicy.has_config_file?(full_path)
      }
    else
      _other -> nil
    end
  end

  defp directory_filter_match?(_name, nil), do: true

  defp directory_filter_match?(name, filter) do
    name
    |> String.downcase()
    |> String.contains?(filter)
  end

  defp directory_error(path, :enoent), do: "Workspace path does not exist: #{path}"
  defp directory_error(path, :not_directory), do: "Workspace path is not a directory: #{path}"

  defp directory_error(path, reason),
    do: "Workspace path does not exist: #{path} (#{:file.format_error(reason)})"
end

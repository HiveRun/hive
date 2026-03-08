defmodule HiveServerElixir.WorkspaceBrowseTypedController do
  use AshTypescript.TypedController

  alias HiveServerElixir.Workspaces

  @hive_config_filename "hive.config.json"

  typed_controller do
    module_name(HiveServerElixirWeb.WorkspaceBrowseController)

    route :workspace_browse do
      method(:get)
      argument(:path, :string)
      argument(:filter, :string)

      run(fn conn, params ->
        target_path = normalize_browse_path(params[:path])
        filter = normalize_filter(params[:filter])

        case list_directories(target_path, filter) do
          {:ok, directories} ->
            Phoenix.Controller.json(conn, %{
              path: target_path,
              parentPath: parent_path(target_path),
              directories: directories
            })

          {:error, reason} ->
            conn
            |> Plug.Conn.put_status(:bad_request)
            |> Phoenix.Controller.json(%{message: directory_error(target_path, reason)})
        end
      end)
    end
  end

  defp list_directories(target_path, filter) do
    with :ok <- validate_directory(target_path),
         {:ok, entries} <- File.ls(target_path) do
      directories =
        entries
        |> Enum.sort()
        |> Enum.map(&build_browse_entry(target_path, &1, filter))
        |> Enum.filter(&is_map/1)

      {:ok, directories}
    end
  end

  defp validate_directory(path) do
    case File.stat(path) do
      {:ok, %File.Stat{type: :directory}} -> :ok
      {:ok, _stat} -> {:error, :not_directory}
      {:error, reason} -> {:error, reason}
    end
  end

  defp normalize_browse_path(nil), do: default_browse_root()

  defp normalize_browse_path(path) when is_binary(path) do
    if String.trim(path) == "" do
      default_browse_root()
    else
      Path.expand(path)
    end
  end

  defp normalize_browse_path(_path), do: default_browse_root()

  defp default_browse_root do
    Workspaces.default_browse_root()
  end

  defp normalize_filter(nil), do: nil

  defp normalize_filter(value) when is_binary(value) do
    trimmed = value |> String.trim() |> String.downcase()
    if trimmed == "", do: nil, else: trimmed
  end

  defp normalize_filter(_value), do: nil

  defp build_browse_entry(target_path, name, filter) do
    full_path = Path.join(target_path, name)

    with true <- directory_filter_match?(name, filter),
         false <- cell_workspace_path?(full_path),
         {:ok, %File.Stat{type: :directory}} <- File.stat(full_path) do
      %{
        name: name,
        path: full_path,
        hasConfig: has_config_file?(full_path)
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

  defp has_config_file?(directory) do
    File.exists?(Path.join(directory, @hive_config_filename))
  end

  defp parent_path(path) do
    parent = Path.dirname(path)
    if parent == path, do: nil, else: parent
  end

  defp cell_workspace_path?(path) do
    hive_home = System.get_env("HIVE_HOME") || Path.join(System.user_home!(), ".hive")
    cells_root = hive_home |> Path.join("cells") |> Path.expand()
    normalized_path = Path.expand(path)

    normalized_path == cells_root || String.starts_with?(normalized_path, cells_root <> "/")
  end

  defp directory_error(path, :enoent), do: "Workspace path does not exist: #{path}"
  defp directory_error(path, :not_directory), do: "Workspace path is not a directory: #{path}"

  defp directory_error(path, reason),
    do: "Workspace path does not exist: #{path} (#{:file.format_error(reason)})"
end

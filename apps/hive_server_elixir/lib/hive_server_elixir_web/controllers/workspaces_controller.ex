defmodule HiveServerElixirWeb.WorkspacesController do
  use HiveServerElixirWeb, :controller

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Workspace
  alias HiveServerElixir.Workspaces

  @hive_config_filename "hive.config.json"

  def index(conn, _params) do
    workspaces = Workspaces.list()
    active_workspace_id = Workspaces.resolve_active_workspace_id(workspaces)

    json(conn, %{
      workspaces: Enum.map(workspaces, &Workspaces.serialize/1),
      activeWorkspaceId: active_workspace_id
    })
  end

  def browse(conn, params) do
    target_path = normalize_browse_path(Map.get(params, "path"))
    filter = normalize_filter(Map.get(params, "filter"))

    with :ok <- validate_directory(target_path),
         {:ok, entries} <- File.ls(target_path) do
      directories =
        entries
        |> Enum.sort()
        |> Enum.map(&build_browse_entry(target_path, &1, filter))
        |> Enum.filter(&is_map/1)

      json(conn, %{
        path: target_path,
        parentPath: parent_path(target_path),
        directories: directories
      })
    else
      {:error, reason} ->
        conn
        |> put_status(:bad_request)
        |> json(%{message: directory_error(target_path, reason)})
    end
  end

  def create(conn, params) do
    path = Map.get(params, "path")
    label = normalize_label(Map.get(params, "label"))
    activate = parse_boolean_param(Map.get(params, "activate"), false)

    with :ok <- validate_workspace_path(path),
         {:ok, workspace_path} <- ensure_workspace_directory(path),
         {:ok, workspace} <- upsert_workspace(workspace_path, label, activate) do
      conn
      |> put_status(:created)
      |> json(%{workspace: Workspaces.serialize(workspace)})
    else
      {:error, reason} ->
        conn
        |> put_status(:bad_request)
        |> json(%{message: reason})
    end
  end

  def activate(conn, %{"id" => id}) do
    case Workspaces.get(id) do
      {:ok, %Workspace{} = workspace} ->
        :ok = Workspaces.set_active_workspace_id(workspace.id)

        refreshed_workspace =
          case Workspaces.get(workspace.id) do
            {:ok, latest_workspace} -> latest_workspace
            {:error, _error} -> workspace
          end

        json(conn, %{workspace: Workspaces.serialize(refreshed_workspace)})

      {:error, _error} ->
        conn
        |> put_status(:not_found)
        |> json(%{message: "Workspace not found"})
    end
  end

  def delete(conn, %{"id" => id}) do
    case Workspaces.get(id) do
      {:ok, %Workspace{} = workspace} ->
        case Ash.destroy(workspace, domain: Cells) do
          :ok ->
            reset_active_workspace_if_needed(id)
            send_resp(conn, :no_content, "")

          {:error, error} ->
            conn
            |> put_status(:bad_request)
            |> json(%{message: "Failed to remove workspace: #{inspect(error)}"})
        end

      {:error, _error} ->
        conn
        |> put_status(:not_found)
        |> json(%{message: "Workspace not found"})
    end
  end

  defp upsert_workspace(workspace_path, label, activate) do
    existing = Workspaces.find_by_path(workspace_path)

    case existing do
      %Workspace{} = workspace ->
        updated_workspace = maybe_update_workspace_label(workspace, label)
        {:ok, maybe_activate_workspace(updated_workspace, activate)}

      nil ->
        resolved_label = label || derive_label_from_path(workspace_path)

        case Ash.create(Workspace, %{path: workspace_path, label: resolved_label}, domain: Cells) do
          {:ok, created_workspace} ->
            {:ok, maybe_activate_workspace(created_workspace, activate)}

          {:error, error} ->
            {:error, "Failed to register workspace: #{inspect(error)}"}
        end
    end
  end

  defp maybe_update_workspace_label(%Workspace{} = workspace, nil), do: workspace

  defp maybe_update_workspace_label(%Workspace{} = workspace, label) do
    if workspace.label == label do
      workspace
    else
      case Ash.update(workspace, %{label: label}, domain: Cells) do
        {:ok, updated_workspace} -> updated_workspace
        {:error, _error} -> workspace
      end
    end
  end

  defp maybe_activate_workspace(%Workspace{} = workspace, activate) do
    should_activate = activate or is_nil(Workspaces.active_workspace_id())

    if should_activate do
      :ok = Workspaces.set_active_workspace_id(workspace.id)

      case Workspaces.get(workspace.id) do
        {:ok, refreshed_workspace} -> refreshed_workspace
        {:error, _error} -> workspace
      end
    else
      workspace
    end
  end

  defp reset_active_workspace_if_needed(deleted_workspace_id) do
    if Workspaces.active_workspace_id() == deleted_workspace_id do
      next_workspace_id =
        Workspaces.list()
        |> List.first()
        |> case do
          %Workspace{id: id} -> id
          _other -> nil
        end

      :ok = Workspaces.set_active_workspace_id(next_workspace_id)
    end
  end

  defp ensure_workspace_directory(path) do
    absolute_path = Path.expand(path)

    with :ok <- validate_directory(absolute_path),
         false <- cell_workspace_path?(absolute_path),
         true <- has_config_file?(absolute_path) do
      {:ok, absolute_path}
    else
      {:error, reason} ->
        {:error, directory_error(absolute_path, reason)}

      true ->
        {:error, "Cell worktrees cannot be registered as workspaces"}

      false ->
        {:error, "Hive config not found in #{absolute_path}. Add #{@hive_config_filename}."}
    end
  end

  defp validate_workspace_path(path) when is_binary(path) do
    if String.trim(path) == "" do
      {:error, "Workspace path is required"}
    else
      :ok
    end
  end

  defp validate_workspace_path(_path), do: {:error, "Workspace path is required"}

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

  defp parse_boolean_param(value, _default) when is_boolean(value), do: value

  defp parse_boolean_param(value, default) when is_binary(value) do
    case String.downcase(String.trim(value)) do
      "true" -> true
      "1" -> true
      "false" -> false
      "0" -> false
      _other -> default
    end
  end

  defp parse_boolean_param(_value, default), do: default

  defp normalize_label(value) when is_binary(value) do
    trimmed = String.trim(value)
    if trimmed == "", do: nil, else: trimmed
  end

  defp normalize_label(_value), do: nil

  defp derive_label_from_path(path) do
    case Path.basename(path) do
      "." -> path
      "" -> path
      value -> value
    end
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

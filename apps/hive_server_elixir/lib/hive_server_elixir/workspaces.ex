defmodule HiveServerElixir.Workspaces do
  @moduledoc false

  import Ash.Expr
  require Ash.Query

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Workspace

  @active_workspace_env_key :active_workspace_id
  @hive_config_filename "hive.config.json"
  @fallback_directory "hive"

  @spec list() :: [Workspace.t()]
  def list do
    Workspace
    |> Ash.Query.sort(inserted_at: :desc)
    |> Ash.read!(domain: Cells)
  end

  @spec bootstrap_current_workspace() :: :ok
  def bootstrap_current_workspace do
    case resolve_startup_workspace_root() do
      path when is_binary(path) ->
        _ = ensure_registered(path, preserve_active_workspace: true)
        :ok

      _other ->
        :ok
    end
  end

  @spec ensure_registered(String.t(), keyword()) :: {:ok, Workspace.t()} | {:error, String.t()}
  def ensure_registered(path, opts \\ [])

  def ensure_registered(path, opts) when is_binary(path) do
    workspace_path = Path.expand(path)
    preserve_active_workspace = Keyword.get(opts, :preserve_active_workspace, false)
    label = Keyword.get(opts, :label)

    with :ok <- validate_workspace_directory(workspace_path) do
      case find_by_path(workspace_path) do
        %Workspace{} = workspace ->
          maybe_activate_workspace(workspace, preserve_active_workspace)
          {:ok, workspace}

        nil ->
          resolved_label = label || derive_label_from_path(workspace_path)

          case Ash.create(Workspace, %{path: workspace_path, label: resolved_label},
                 domain: Cells
               ) do
            {:ok, workspace} ->
              maybe_activate_workspace(workspace, preserve_active_workspace)
              {:ok, workspace}

            {:error, error} ->
              {:error, "Failed to register workspace: #{inspect(error)}"}
          end
      end
    end
  end

  def ensure_registered(_path, _opts), do: {:error, "Workspace path is required"}

  @spec default_browse_root() :: String.t()
  def default_browse_root do
    case System.get_env("HIVE_BROWSE_ROOT") do
      value when is_binary(value) and value != "" -> Path.expand(value)
      _other -> resolve_startup_workspace_root() || System.user_home!() || "."
    end
  end

  @spec get(String.t()) :: {:ok, Workspace.t()} | {:error, term()}
  def get(workspace_id) when is_binary(workspace_id) do
    Ash.get(Workspace, workspace_id, domain: Cells)
  end

  @spec find_by_path(String.t()) :: Workspace.t() | nil
  def find_by_path(path) when is_binary(path) do
    Workspace
    |> Ash.Query.filter(expr(path == ^path))
    |> Ash.read_one!(domain: Cells)
  end

  @spec active_workspace_id() :: String.t() | nil
  def active_workspace_id do
    case Application.get_env(:hive_server_elixir, @active_workspace_env_key) do
      workspace_id when is_binary(workspace_id) and byte_size(workspace_id) > 0 -> workspace_id
      _value -> nil
    end
  end

  @spec set_active_workspace_id(String.t() | nil) :: :ok
  def set_active_workspace_id(nil) do
    Application.delete_env(:hive_server_elixir, @active_workspace_env_key)
    :ok
  end

  def set_active_workspace_id(workspace_id)
      when is_binary(workspace_id) and byte_size(workspace_id) > 0 do
    Application.put_env(:hive_server_elixir, @active_workspace_env_key, workspace_id)
    :ok
  end

  @spec resolve_active_workspace_id([Workspace.t()]) :: String.t() | nil
  def resolve_active_workspace_id(workspaces) when is_list(workspaces) do
    current = active_workspace_id()

    cond do
      is_binary(current) and Enum.any?(workspaces, &(&1.id == current)) ->
        current

      true ->
        case workspaces do
          [%Workspace{id: workspace_id} | _rest] ->
            :ok = set_active_workspace_id(workspace_id)
            workspace_id

          [] ->
            :ok = set_active_workspace_id(nil)
            nil
        end
    end
  end

  @spec resolve(String.t() | nil) ::
          {:ok, Workspace.t()} | {:error, :workspace_not_found | :workspace_required}
  def resolve(workspace_id) when is_binary(workspace_id) and byte_size(workspace_id) > 0 do
    case get(workspace_id) do
      {:ok, %Workspace{} = workspace} -> {:ok, workspace}
      {:error, _error} -> {:error, :workspace_not_found}
    end
  end

  def resolve(nil) do
    workspaces = list()

    case resolve_active_workspace_id(workspaces) do
      workspace_id when is_binary(workspace_id) ->
        case Enum.find(workspaces, &(&1.id == workspace_id)) do
          %Workspace{} = workspace -> {:ok, workspace}
          nil -> {:error, :workspace_required}
        end

      _value ->
        {:error, :workspace_required}
    end
  end

  @spec serialize(Workspace.t()) :: map()
  def serialize(%Workspace{} = workspace) do
    label =
      case workspace.label do
        value when is_binary(value) and byte_size(value) > 0 -> value
        _value -> derive_label_from_path(workspace.path)
      end

    %{
      id: workspace.id,
      label: label,
      path: workspace.path,
      addedAt: to_iso8601(workspace.inserted_at),
      lastOpenedAt: nil
    }
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

  defp validate_workspace_directory(path) do
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

  defp maybe_activate_workspace(%Workspace{} = workspace, preserve_active_workspace) do
    if active_workspace_id() == nil or not preserve_active_workspace do
      set_active_workspace_id(workspace.id)
    else
      :ok
    end
  end

  defp has_config_file?(directory) when is_binary(directory) do
    File.exists?(Path.join(directory, @hive_config_filename))
  end

  defp cell_workspace_path?(path) when is_binary(path) do
    hive_home = System.get_env("HIVE_HOME") || Path.join(System.user_home!(), ".hive")
    cells_root = hive_home |> Path.join("cells") |> Path.expand()
    normalized_path = Path.expand(path)

    normalized_path == cells_root || String.starts_with?(normalized_path, cells_root <> "/")
  end

  defp derive_label_from_path(path) when is_binary(path) do
    case Path.basename(path) do
      "." -> path
      "" -> path
      value -> value
    end
  end

  defp to_iso8601(%DateTime{} = value), do: DateTime.to_iso8601(value)
  defp to_iso8601(%NaiveDateTime{} = value), do: NaiveDateTime.to_iso8601(value)
  defp to_iso8601(value) when is_binary(value), do: value
  defp to_iso8601(_value), do: DateTime.utc_now() |> DateTime.to_iso8601()
end

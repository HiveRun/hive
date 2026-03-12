defmodule HiveServerElixir.Workspaces do
  @moduledoc false

  import Ash.Expr
  require Ash.Query

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Workspace
  alias HiveServerElixir.Workspaces.PathPolicy

  @spec list() :: [Workspace.t()]
  def list do
    Workspace
    |> Ash.Query.for_read(:ui_list, %{})
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
    label = normalize_label(Keyword.get(opts, :label))

    case Ash.create(
           Workspace,
           %{path: workspace_path, label: label, activate: not preserve_active_workspace},
           action: :register,
           domain: Cells
         ) do
      {:ok, workspace} ->
        {:ok, workspace}

      {:error, error} ->
        {:error, Ash.Error.to_error_class(error).message}
    end
  end

  def ensure_registered(_path, _opts), do: {:error, "Workspace path is required"}

  @spec default_browse_root() :: String.t()
  def default_browse_root, do: PathPolicy.default_browse_root()

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
    case List.first(list()) do
      %Workspace{id: workspace_id} -> workspace_id
      _other -> nil
    end
  end

  @spec set_active_workspace_id(String.t() | nil) :: :ok
  def set_active_workspace_id(nil) do
    Workspace
    |> Ash.read!(domain: Cells)
    |> Enum.each(fn workspace ->
      _ = Ash.update(workspace, %{last_opened_at: nil}, domain: Cells)
    end)

    :ok
  end

  def set_active_workspace_id(workspace_id)
      when is_binary(workspace_id) and byte_size(workspace_id) > 0 do
    with {:ok, %Workspace{} = workspace} <- get(workspace_id),
         {:ok, _updated_workspace} <- Ash.update(workspace, %{}, action: :activate, domain: Cells) do
      :ok
    else
      {:error, _error} -> :ok
    end
  end

  @spec resolve_active_workspace_id([Workspace.t()]) :: String.t() | nil
  def resolve_active_workspace_id(workspaces) when is_list(workspaces) do
    case Enum.sort_by(workspaces, &workspace_sort_key/1, :desc) do
      [%Workspace{id: workspace_id} | _rest] ->
        workspace_id

      [] ->
        nil
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

  @spec resolve_startup_workspace_root() :: String.t() | nil
  def resolve_startup_workspace_root, do: PathPolicy.resolve_startup_workspace_root()

  @spec validate_registration_path(String.t()) :: :ok | {:error, String.t()}
  def validate_registration_path(path), do: PathPolicy.validate_registration_path(path)

  @spec derive_label_from_path(String.t()) :: String.t()
  def derive_label_from_path(path), do: PathPolicy.derive_label_from_path(path)

  defp workspace_sort_key(%Workspace{} = workspace) do
    last_opened_at = workspace.last_opened_at || workspace.inserted_at
    inserted_at = workspace.inserted_at
    {timestamp_sort_key(last_opened_at), timestamp_sort_key(inserted_at)}
  end

  defp timestamp_sort_key(%DateTime{} = value), do: DateTime.to_unix(value, :microsecond)

  defp timestamp_sort_key(%NaiveDateTime{} = value),
    do: DateTime.from_naive!(value, "Etc/UTC") |> DateTime.to_unix(:microsecond)

  defp timestamp_sort_key(_value), do: 0

  defp normalize_label(value) when is_binary(value) do
    trimmed = String.trim(value)
    if trimmed == "", do: nil, else: trimmed
  end

  defp normalize_label(_value), do: nil
end

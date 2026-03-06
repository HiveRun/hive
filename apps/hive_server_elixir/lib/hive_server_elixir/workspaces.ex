defmodule HiveServerElixir.Workspaces do
  @moduledoc false

  import Ash.Expr
  require Ash.Query

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Workspace

  @active_workspace_env_key :active_workspace_id

  @spec list() :: [Workspace.t()]
  def list do
    Workspace
    |> Ash.Query.sort(inserted_at: :desc)
    |> Ash.read!(domain: Cells)
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

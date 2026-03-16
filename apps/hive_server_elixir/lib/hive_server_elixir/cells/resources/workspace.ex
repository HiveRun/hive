defmodule HiveServerElixir.Cells.Workspace do
  @moduledoc false

  import Ash.Expr
  require Ash.Query

  alias HiveServerElixir.Workspaces.PathPolicy

  use Ash.Resource,
    extensions: [AshTypescript.Resource],
    domain: HiveServerElixir.Cells,
    data_layer: AshSqlite.DataLayer

  typescript do
    type_name "Workspace"
  end

  sqlite do
    table "workspaces"
    repo HiveServerElixir.Repo
  end

  actions do
    defaults [:read, :destroy]

    read :ui_list do
      prepare build(sort: [last_opened_at: :desc, inserted_at: :desc])
    end

    create :create do
      primary? true
      accept [:path, :label, :last_opened_at]
    end

    create :register do
      argument :path, :string do
        allow_nil? false
        public? true
      end

      argument :label, :string do
        allow_nil? true
        public? true
      end

      argument :activate, :boolean do
        allow_nil? false
        default false
        public? true
      end

      upsert? true
      upsert_identity :unique_path

      change fn changeset, _context ->
        changeset
        |> normalize_register_input()
        |> Ash.Changeset.before_action(&prepare_register_workspace/1)
      end
    end

    update :update do
      primary? true
      accept [:path, :label, :last_opened_at]
    end

    update :activate do
      accept []
      require_atomic? false

      change atomic_update(:last_opened_at, expr(now()))
    end
  end

  attributes do
    uuid_primary_key :id

    attribute :path, :string do
      allow_nil? false
      public? true
    end

    attribute :label, :string do
      allow_nil? true
      public? true
    end

    attribute :last_opened_at, :utc_datetime_usec do
      allow_nil? true
      public? true
    end

    create_timestamp :inserted_at, public?: true
    update_timestamp :updated_at, public?: true
  end

  relationships do
    has_many :cells, HiveServerElixir.Cells.Cell
  end

  identities do
    identity :unique_path, [:path]
  end

  defp normalize_register_input(changeset) do
    path =
      changeset
      |> Ash.Changeset.get_argument(:path)
      |> normalize_path_argument()

    label =
      changeset
      |> Ash.Changeset.get_argument(:label)
      |> normalize_label_argument()

    changeset
    |> Ash.Changeset.force_change_attribute(:path, path)
    |> maybe_force_label(label)
    |> maybe_add_missing_path_error(path)
  end

  defp prepare_register_workspace(changeset) do
    path = Ash.Changeset.get_attribute(changeset, :path)

    with true <- is_binary(path),
         :ok <- PathPolicy.validate_registration_path(path) do
      existing_workspace = existing_workspace_for_path(path)

      should_activate =
        Ash.Changeset.get_argument(changeset, :activate) ||
          is_nil(active_workspace_id())

      label =
        changeset
        |> Ash.Changeset.get_attribute(:label)
        |> default_register_label(path, existing_workspace)

      changeset
      |> Ash.Changeset.force_change_attribute(:label, label)
      |> maybe_set_registered_last_opened_at(existing_workspace, should_activate)
    else
      false -> changeset
      {:error, message} -> Ash.Changeset.add_error(changeset, field: :path, message: message)
    end
  end

  defp normalize_path_argument(value) when is_binary(value) do
    trimmed = String.trim(value)
    if trimmed == "", do: nil, else: Path.expand(trimmed)
  end

  defp normalize_path_argument(_value), do: nil

  defp normalize_label_argument(value) when is_binary(value) do
    trimmed = String.trim(value)
    if trimmed == "", do: nil, else: trimmed
  end

  defp normalize_label_argument(_value), do: nil

  defp maybe_force_label(changeset, nil), do: changeset

  defp maybe_force_label(changeset, label) do
    Ash.Changeset.force_change_attribute(changeset, :label, label)
  end

  defp maybe_add_missing_path_error(changeset, nil) do
    Ash.Changeset.add_error(changeset, field: :path, message: "Workspace path is required")
  end

  defp maybe_add_missing_path_error(changeset, _path), do: changeset

  defp default_register_label(label, _path, _existing_workspace) when is_binary(label), do: label

  defp default_register_label(nil, _path, %{label: label}) when is_binary(label) and label != "",
    do: label

  defp default_register_label(nil, _path, %{}), do: nil

  defp default_register_label(nil, path, _existing_workspace),
    do: PathPolicy.derive_label_from_path(path)

  defp maybe_set_registered_last_opened_at(changeset, _existing_workspace, true) do
    Ash.Changeset.force_change_attribute(changeset, :last_opened_at, DateTime.utc_now())
  end

  defp maybe_set_registered_last_opened_at(changeset, %{last_opened_at: last_opened_at}, false) do
    Ash.Changeset.force_change_attribute(changeset, :last_opened_at, last_opened_at)
  end

  defp maybe_set_registered_last_opened_at(changeset, _existing_workspace, false), do: changeset

  defp existing_workspace_for_path(path) when is_binary(path) do
    __MODULE__
    |> Ash.Query.filter(expr(path == ^path))
    |> Ash.read_one!()
  end

  defp active_workspace_id do
    __MODULE__
    |> Ash.Query.for_read(:ui_list, %{})
    |> Ash.read!()
    |> case do
      [%{id: workspace_id} | _rest] -> workspace_id
      _other -> nil
    end
  end
end

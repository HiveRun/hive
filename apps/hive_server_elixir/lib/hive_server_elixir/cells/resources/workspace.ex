defmodule HiveServerElixir.Cells.Workspace do
  @moduledoc false

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

    update :update do
      primary? true
      accept [:path, :label, :last_opened_at]
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
end

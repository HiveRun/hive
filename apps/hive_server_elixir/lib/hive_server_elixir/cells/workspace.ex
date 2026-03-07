defmodule HiveServerElixir.Cells.Workspace do
  @moduledoc false

  use Ash.Resource,
    domain: HiveServerElixir.Cells,
    data_layer: AshSqlite.DataLayer

  sqlite do
    table "workspaces"
    repo HiveServerElixir.Repo
  end

  actions do
    defaults [:read, :destroy]

    create :create do
      primary? true
      accept [:path, :label]
    end

    update :update do
      primary? true
      accept [:path, :label]
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

    create_timestamp :inserted_at
    update_timestamp :updated_at
  end

  relationships do
    has_many :cells, HiveServerElixir.Cells.Cell
  end

  identities do
    identity :unique_path, [:path]
  end
end

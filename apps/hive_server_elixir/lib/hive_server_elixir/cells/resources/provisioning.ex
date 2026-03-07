defmodule HiveServerElixir.Cells.Provisioning do
  @moduledoc false

  use Ash.Resource,
    domain: HiveServerElixir.Cells,
    data_layer: AshSqlite.DataLayer

  sqlite do
    table "cell_provisioning_states"
    repo HiveServerElixir.Repo
  end

  actions do
    defaults [:read, :destroy]

    create :create do
      primary? true

      accept [
        :cell_id,
        :model_id_override,
        :provider_id_override,
        :start_mode,
        :started_at,
        :finished_at,
        :attempt_count
      ]
    end

    update :update do
      primary? true

      accept [
        :model_id_override,
        :provider_id_override,
        :start_mode,
        :started_at,
        :finished_at,
        :attempt_count
      ]
    end
  end

  attributes do
    uuid_primary_key :id

    attribute :model_id_override, :string do
      allow_nil? true
      public? true
    end

    attribute :provider_id_override, :string do
      allow_nil? true
      public? true
    end

    attribute :start_mode, :string do
      allow_nil? true
      public? true
    end

    attribute :started_at, :utc_datetime_usec do
      allow_nil? true
      public? true
    end

    attribute :finished_at, :utc_datetime_usec do
      allow_nil? true
      public? true
    end

    attribute :attempt_count, :integer do
      allow_nil? false
      default 0
      public? true
    end

    create_timestamp :inserted_at
    update_timestamp :updated_at
  end

  relationships do
    belongs_to :cell, HiveServerElixir.Cells.Cell do
      allow_nil? false
      public? true
      attribute_writable? true
    end
  end

  identities do
    identity :unique_cell, [:cell_id]
  end
end

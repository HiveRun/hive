defmodule HiveServerElixir.Cells.AgentSession do
  @moduledoc false

  use Ash.Resource,
    domain: HiveServerElixir.Cells,
    data_layer: AshSqlite.DataLayer

  sqlite do
    table "cell_agent_sessions"
    repo HiveServerElixir.Repo
  end

  actions do
    defaults [:read, :destroy]

    create :create do
      primary? true

      accept [
        :cell_id,
        :session_id,
        :model_id,
        :model_provider_id,
        :start_mode,
        :current_mode,
        :resume_on_startup,
        :last_error
      ]
    end

    update :update do
      primary? true
      accept [:model_id, :model_provider_id, :current_mode, :resume_on_startup, :last_error]
    end
  end

  attributes do
    uuid_primary_key :id

    attribute :session_id, :string do
      allow_nil? false
      public? true
    end

    attribute :model_id, :string do
      allow_nil? true
      public? true
    end

    attribute :model_provider_id, :string do
      allow_nil? true
      public? true
    end

    attribute :start_mode, :string do
      allow_nil? true
      public? true
    end

    attribute :current_mode, :string do
      allow_nil? true
      public? true
    end

    attribute :resume_on_startup, :boolean do
      allow_nil? false
      public? true
      default false
    end

    attribute :last_error, :string do
      allow_nil? true
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
    identity :unique_session_id, [:session_id]
  end
end

defmodule HiveServerElixir.Cells.Cell do
  @moduledoc false

  use Ash.Resource,
    domain: HiveServerElixir.Cells,
    data_layer: AshSqlite.DataLayer

  sqlite do
    table "cells"
    repo HiveServerElixir.Repo
  end

  actions do
    defaults [:read, :destroy]

    create :create do
      primary? true
      accept [:workspace_id, :description, :status]
    end

    update :update do
      primary? true
      accept [:description, :status]
    end
  end

  attributes do
    uuid_primary_key :id

    attribute :description, :string do
      allow_nil? true
      public? true
    end

    attribute :status, :string do
      allow_nil? false
      public? true
      default "provisioning"
    end

    create_timestamp :inserted_at
    update_timestamp :updated_at
  end

  relationships do
    belongs_to :workspace, HiveServerElixir.Cells.Workspace do
      allow_nil? false
      public? true
      attribute_writable? true
    end

    has_one :provisioning_state, HiveServerElixir.Cells.Provisioning do
      destination_attribute :cell_id
    end

    has_one :agent_session, HiveServerElixir.Cells.AgentSession do
      destination_attribute :cell_id
    end

    has_many :services, HiveServerElixir.Cells.Service do
      destination_attribute :cell_id
    end

    has_many :activity_events, HiveServerElixir.Cells.Activity do
      destination_attribute :cell_id
    end

    has_many :timing_events, HiveServerElixir.Cells.Timing do
      destination_attribute :cell_id
    end
  end
end

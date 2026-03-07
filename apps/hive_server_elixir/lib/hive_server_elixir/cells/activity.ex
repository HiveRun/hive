defmodule HiveServerElixir.Cells.Activity do
  @moduledoc false

  use Ash.Resource,
    domain: HiveServerElixir.Cells,
    data_layer: AshSqlite.DataLayer

  sqlite do
    table "cell_activity_events"
    repo HiveServerElixir.Repo
  end

  actions do
    defaults [:read, :destroy]

    create :create do
      primary? true
      accept [:cell_id, :service_id, :type, :source, :tool_name, :metadata]
    end
  end

  attributes do
    uuid_primary_key :id

    attribute :type, :string do
      allow_nil? false
      public? true
    end

    attribute :source, :string do
      allow_nil? true
      public? true
    end

    attribute :tool_name, :string do
      allow_nil? true
      public? true
    end

    attribute :metadata, :map do
      allow_nil? false
      public? true
      default %{}
    end

    create_timestamp :inserted_at
  end

  relationships do
    belongs_to :cell, HiveServerElixir.Cells.Cell do
      allow_nil? false
      public? true
      attribute_writable? true
    end

    belongs_to :service, HiveServerElixir.Cells.Service do
      allow_nil? true
      public? true
      attribute_writable? true
    end
  end
end

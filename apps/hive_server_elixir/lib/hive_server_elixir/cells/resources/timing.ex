defmodule HiveServerElixir.Cells.Timing do
  @moduledoc false

  use Ash.Resource,
    domain: HiveServerElixir.Cells,
    data_layer: AshSqlite.DataLayer

  sqlite do
    table "cell_timing_events"
    repo HiveServerElixir.Repo
  end

  actions do
    defaults [:read, :destroy]

    create :create do
      primary? true

      accept [
        :cell_id,
        :cell_name,
        :workspace_id,
        :template_id,
        :workflow,
        :run_id,
        :step,
        :status,
        :duration_ms,
        :attempt,
        :error,
        :metadata
      ]
    end
  end

  attributes do
    uuid_primary_key :id

    attribute :cell_name, :string do
      allow_nil? true
      public? true
    end

    attribute :workspace_id, :uuid do
      allow_nil? true
      public? true
    end

    attribute :template_id, :string do
      allow_nil? true
      public? true
    end

    attribute :workflow, :string do
      allow_nil? false
      public? true
    end

    attribute :run_id, :string do
      allow_nil? false
      public? true
    end

    attribute :step, :string do
      allow_nil? false
      public? true
    end

    attribute :status, :string do
      allow_nil? false
      public? true
    end

    attribute :duration_ms, :integer do
      allow_nil? false
      public? true
    end

    attribute :attempt, :integer do
      allow_nil? true
      public? true
    end

    attribute :error, :string do
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
      allow_nil? true
      public? true
      attribute_writable? true
    end
  end
end

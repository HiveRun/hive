defmodule HiveServerElixir.Cells.Service do
  @moduledoc false

  use Ash.Resource,
    domain: HiveServerElixir.Cells,
    data_layer: AshSqlite.DataLayer

  sqlite do
    table "cell_services"
    repo HiveServerElixir.Repo
  end

  actions do
    defaults [:read, :destroy]

    create :create do
      primary? true

      accept [
        :cell_id,
        :name,
        :type,
        :command,
        :cwd,
        :env,
        :status,
        :port,
        :pid,
        :ready_timeout_ms,
        :definition,
        :last_known_error
      ]
    end

    update :update do
      primary? true
      accept [:status, :port, :pid, :last_known_error]
    end
  end

  attributes do
    uuid_primary_key :id

    attribute :name, :string do
      allow_nil? false
      public? true
    end

    attribute :type, :string do
      allow_nil? false
      public? true
    end

    attribute :command, :string do
      allow_nil? false
      public? true
    end

    attribute :cwd, :string do
      allow_nil? false
      public? true
    end

    attribute :env, :map do
      allow_nil? false
      public? true
      default %{}
    end

    attribute :status, :string do
      allow_nil? false
      public? true
      default "pending"
    end

    attribute :port, :integer do
      allow_nil? true
      public? true
    end

    attribute :pid, :integer do
      allow_nil? true
      public? true
    end

    attribute :ready_timeout_ms, :integer do
      allow_nil? true
      public? true
    end

    attribute :definition, :map do
      allow_nil? false
      public? true
      default %{}
    end

    attribute :last_known_error, :string do
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
end

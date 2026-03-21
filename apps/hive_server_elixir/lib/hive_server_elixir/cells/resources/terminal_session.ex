defmodule HiveServerElixir.Cells.TerminalSession do
  @moduledoc false

  import Ash.Expr

  alias HiveServerElixir.Cells.TerminalSessionKind
  alias HiveServerElixir.Cells.TerminalSessionStatus

  use Ash.Resource,
    extensions: [AshTypescript.Resource],
    domain: HiveServerElixir.Cells,
    data_layer: AshSqlite.DataLayer

  typescript do
    type_name "TerminalSession"
  end

  sqlite do
    table "cell_terminal_sessions"
    repo HiveServerElixir.Repo
  end

  actions do
    defaults [:read, :destroy]

    read :for_cell do
      argument :cell_id, :uuid do
        allow_nil? false
        public? true
      end

      argument :kind, TerminalSessionKind do
        allow_nil? true
        public? true
      end

      prepare build(sort: [inserted_at: :asc])

      filter expr(
               cell_id == ^arg(:cell_id) and
                 (is_nil(^arg(:kind)) or kind == ^arg(:kind))
             )
    end

    create :open do
      primary? true

      accept [
        :session_key,
        :cell_id,
        :service_id,
        :kind,
        :runtime_session_id,
        :cols,
        :rows
      ]

      upsert? true
      upsert_identity :unique_session_key

      upsert_fields [
        :cell_id,
        :service_id,
        :kind,
        :runtime_session_id,
        :cols,
        :rows,
        :status,
        :started_at,
        :ended_at
      ]

      change fn changeset, _context ->
        changeset
        |> Ash.Changeset.force_change_attribute(:status, :running)
        |> Ash.Changeset.force_change_attribute(:started_at, now())
        |> Ash.Changeset.force_change_attribute(:ended_at, nil)
      end
    end

    update :resize do
      accept [:cols, :rows]
      require_atomic? false
    end

    update :restart do
      accept [:runtime_session_id, :cols, :rows]
      require_atomic? false

      change fn changeset, _context ->
        changeset
        |> Ash.Changeset.force_change_attribute(:status, :running)
        |> Ash.Changeset.force_change_attribute(:started_at, now())
        |> Ash.Changeset.force_change_attribute(:ended_at, nil)
      end
    end

    update :close do
      accept []
      require_atomic? false

      change fn changeset, _context ->
        changeset
        |> Ash.Changeset.force_change_attribute(:status, :closed)
        |> Ash.Changeset.force_change_attribute(:ended_at, now())
      end
    end
  end

  attributes do
    uuid_primary_key :id

    attribute :session_key, :string do
      allow_nil? false
      public? true
    end

    attribute :kind, TerminalSessionKind do
      allow_nil? false
      public? true
    end

    attribute :runtime_session_id, :string do
      allow_nil? false
      public? true
    end

    attribute :status, TerminalSessionStatus do
      allow_nil? false
      public? true
      default :running
    end

    attribute :cols, :integer do
      allow_nil? false
      public? true
      constraints min: 1
    end

    attribute :rows, :integer do
      allow_nil? false
      public? true
      constraints min: 1
    end

    attribute :started_at, :utc_datetime_usec do
      allow_nil? false
      public? true
    end

    attribute :ended_at, :utc_datetime_usec do
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

    belongs_to :service, HiveServerElixir.Cells.Service do
      allow_nil? true
      public? true
      attribute_writable? true
    end
  end

  identities do
    identity :unique_session_key, [:session_key]
  end

  defp now do
    DateTime.utc_now() |> DateTime.truncate(:second)
  end
end

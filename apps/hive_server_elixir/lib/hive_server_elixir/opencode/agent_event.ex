defmodule HiveServerElixir.Opencode.AgentEvent do
  @moduledoc """
  Append-only OpenCode event envelope persisted for projection/replay.
  """

  use Ash.Resource,
    domain: HiveServerElixir.Opencode,
    data_layer: AshSqlite.DataLayer

  sqlite do
    table "agent_event_log"
    repo HiveServerElixir.Repo
  end

  actions do
    defaults [:read]

    create :append do
      primary? true
      accept [:workspace_id, :cell_id, :session_id, :seq, :event_type, :payload]
    end
  end

  attributes do
    integer_primary_key :id

    attribute :workspace_id, :string do
      allow_nil? false
      public? true
    end

    attribute :cell_id, :string do
      allow_nil? false
      public? true
    end

    attribute :session_id, :string do
      allow_nil? false
      public? true
    end

    attribute :seq, :integer do
      allow_nil? false
      public? true
    end

    attribute :event_type, :string do
      allow_nil? false
      public? true
    end

    attribute :payload, :map do
      allow_nil? false
      public? true
    end

    create_timestamp :inserted_at
  end

  identities do
    identity :unique_session_seq, [:session_id, :seq]
  end
end

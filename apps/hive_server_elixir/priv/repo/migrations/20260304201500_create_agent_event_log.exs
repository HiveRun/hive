defmodule HiveServerElixir.Repo.Migrations.CreateAgentEventLog do
  use Ecto.Migration

  def change do
    create table(:agent_event_log) do
      add(:workspace_id, :text, null: false)
      add(:cell_id, :text, null: false)
      add(:session_id, :text, null: false)
      add(:seq, :bigint, null: false)
      add(:event_type, :text, null: false)
      add(:payload, :map, null: false)

      timestamps(updated_at: false, type: :utc_datetime_usec)
    end

    create(index(:agent_event_log, [:workspace_id, :cell_id]))
    create(index(:agent_event_log, [:session_id]))
    create(unique_index(:agent_event_log, [:session_id, :seq]))
  end
end

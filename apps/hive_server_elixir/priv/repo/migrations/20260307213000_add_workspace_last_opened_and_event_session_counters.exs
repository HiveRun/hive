defmodule HiveServerElixir.Repo.Migrations.AddWorkspaceRecencyAndEventCounters do
  use Ecto.Migration

  def change do
    alter table(:workspaces) do
      add(:last_opened_at, :utc_datetime_usec)
    end

    create table(:agent_event_session_counters, primary_key: false) do
      add(:session_id, :text, null: false, primary_key: true)
      add(:last_seq, :bigint, null: false, default: 0)

      timestamps(type: :utc_datetime_usec)
    end
  end
end

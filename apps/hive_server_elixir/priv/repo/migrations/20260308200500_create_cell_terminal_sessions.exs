defmodule HiveServerElixir.Repo.Migrations.CreateCellTerminalSessions do
  use Ecto.Migration

  def change do
    create table(:cell_terminal_sessions, primary_key: false) do
      add(:id, :uuid, null: false, primary_key: true)
      add(:session_key, :text, null: false)
      add(:kind, :text, null: false)
      add(:runtime_session_id, :text, null: false)
      add(:status, :text, null: false, default: "running")
      add(:cols, :integer, null: false)
      add(:rows, :integer, null: false)
      add(:started_at, :utc_datetime_usec, null: false)
      add(:ended_at, :utc_datetime_usec)

      add(
        :cell_id,
        references(:cells, type: :uuid, on_delete: :delete_all),
        null: false
      )

      add(
        :service_id,
        references(:cell_services, type: :uuid, on_delete: :delete_all)
      )

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:cell_terminal_sessions, [:session_key]))
    create(index(:cell_terminal_sessions, [:cell_id]))
    create(index(:cell_terminal_sessions, [:service_id]))
    create(index(:cell_terminal_sessions, [:kind]))
    create(index(:cell_terminal_sessions, [:status]))
  end
end

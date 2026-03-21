defmodule HiveServerElixir.Repo.Migrations.CreateCellLifecycleResources do
  use Ecto.Migration

  def change do
    create table(:cell_provisioning_states, primary_key: false) do
      add(:id, :uuid, null: false, primary_key: true)

      add(
        :cell_id,
        references(:cells, type: :uuid, on_delete: :delete_all),
        null: false
      )

      add(:model_id_override, :text)
      add(:provider_id_override, :text)
      add(:start_mode, :text)
      add(:started_at, :utc_datetime_usec)
      add(:finished_at, :utc_datetime_usec)
      add(:attempt_count, :integer, null: false, default: 0)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:cell_provisioning_states, [:cell_id]))

    create table(:cell_services, primary_key: false) do
      add(:id, :uuid, null: false, primary_key: true)

      add(
        :cell_id,
        references(:cells, type: :uuid, on_delete: :delete_all),
        null: false
      )

      add(:name, :text, null: false)
      add(:type, :text, null: false)
      add(:command, :text, null: false)
      add(:cwd, :text, null: false)
      add(:env, :map, null: false)
      add(:status, :text, null: false, default: "pending")
      add(:port, :integer)
      add(:pid, :integer)
      add(:ready_timeout_ms, :integer)
      add(:definition, :map, null: false)
      add(:last_known_error, :text)

      timestamps(type: :utc_datetime_usec)
    end

    create(index(:cell_services, [:cell_id]))
    create(index(:cell_services, [:status]))

    create table(:cell_agent_sessions, primary_key: false) do
      add(:id, :uuid, null: false, primary_key: true)

      add(
        :cell_id,
        references(:cells, type: :uuid, on_delete: :delete_all),
        null: false
      )

      add(:session_id, :text, null: false)
      add(:model_id, :text)
      add(:model_provider_id, :text)
      add(:start_mode, :text)
      add(:current_mode, :text)
      add(:resume_on_startup, :boolean, null: false, default: false)
      add(:last_error, :text)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:cell_agent_sessions, [:cell_id]))
    create(unique_index(:cell_agent_sessions, [:session_id]))

    create table(:cell_activity_events, primary_key: false) do
      add(:id, :uuid, null: false, primary_key: true)

      add(
        :cell_id,
        references(:cells, type: :uuid, on_delete: :delete_all),
        null: false
      )

      add(
        :service_id,
        references(:cell_services, type: :uuid, on_delete: :delete_all)
      )

      add(:type, :text, null: false)
      add(:source, :text)
      add(:tool_name, :text)
      add(:metadata, :map, null: false)
      add(:inserted_at, :utc_datetime_usec, null: false)
    end

    create(index(:cell_activity_events, [:cell_id]))
    create(index(:cell_activity_events, [:type]))

    create table(:cell_timing_events, primary_key: false) do
      add(:id, :uuid, null: false, primary_key: true)
      add(:cell_id, references(:cells, type: :uuid, on_delete: :nilify_all))
      add(:cell_name, :text)
      add(:workspace_id, :uuid)
      add(:template_id, :text)
      add(:workflow, :text, null: false)
      add(:run_id, :text, null: false)
      add(:step, :text, null: false)
      add(:status, :text, null: false)
      add(:duration_ms, :integer, null: false)
      add(:attempt, :integer)
      add(:error, :text)
      add(:metadata, :map, null: false)
      add(:inserted_at, :utc_datetime_usec, null: false)
    end

    create(index(:cell_timing_events, [:cell_id]))
    create(index(:cell_timing_events, [:workflow]))
    create(index(:cell_timing_events, [:run_id]))
  end
end

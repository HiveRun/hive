defmodule HiveServerElixir.Repo.Migrations.CreateWorkspacesAndCells do
  use Ecto.Migration

  def change do
    create table(:workspaces, primary_key: false) do
      add(:id, :uuid, null: false, primary_key: true)
      add(:path, :text, null: false)
      add(:label, :text)

      timestamps(type: :utc_datetime_usec)
    end

    create(unique_index(:workspaces, [:path]))

    create table(:cells, primary_key: false) do
      add(:id, :uuid, null: false, primary_key: true)

      add(
        :workspace_id,
        references(:workspaces, type: :uuid, on_delete: :delete_all),
        null: false
      )

      add(:description, :text)
      add(:status, :text, null: false, default: "provisioning")

      timestamps(type: :utc_datetime_usec)
    end

    create(index(:cells, [:workspace_id]))
    create(index(:cells, [:status]))
  end
end

defmodule HiveServerElixir.Repo.Migrations.AddCellContractFields do
  use Ecto.Migration

  def change do
    alter table(:cells) do
      add(:name, :text, null: false, default: "Cell")
      add(:template_id, :text, null: false, default: "default-template")
      add(:workspace_root_path, :text, default: "")
      add(:workspace_path, :text, default: "")
      add(:opencode_session_id, :text)
      add(:resume_agent_session_on_startup, :boolean, null: false, default: false)
      add(:last_setup_error, :text)
      add(:branch_name, :text)
      add(:base_commit, :text)
    end
  end
end

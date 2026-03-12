defmodule HiveServerElixir.Repo.Migrations.NormalizeServiceStatuses do
  use Ecto.Migration

  def up do
    execute("UPDATE cell_services SET status = 'stopped' WHERE status = 'pending'")
  end

  def down do
    execute("UPDATE cell_services SET status = 'pending' WHERE status = 'stopped'")
  end
end

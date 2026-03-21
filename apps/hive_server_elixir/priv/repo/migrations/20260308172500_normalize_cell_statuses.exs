defmodule HiveServerElixir.Repo.Migrations.NormalizeCellStatuses do
  use Ecto.Migration

  def up do
    execute("UPDATE cells SET status = 'provisioning' WHERE status IN ('spawning', 'pending')")
    execute("UPDATE cells SET status = 'stopped' WHERE status = 'paused'")
    execute("UPDATE cells SET status = 'error' WHERE status = 'failed'")
  end

  def down do
    :ok
  end
end

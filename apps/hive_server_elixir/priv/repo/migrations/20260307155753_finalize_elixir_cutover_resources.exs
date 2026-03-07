defmodule HiveServerElixir.Repo.Migrations.FinalizeElixirCutoverResources do
  @moduledoc """
  Records the Ash resource snapshot baseline for the current Elixir cutover schema.

  The schema tables already exist via the earlier hand-authored migrations in this
  repo, so this migration is intentionally a no-op. The paired resource snapshots
  let Ash codegen treat that existing schema as the current baseline.
  """

  use Ecto.Migration

  def up, do: :ok

  def down, do: :ok
end

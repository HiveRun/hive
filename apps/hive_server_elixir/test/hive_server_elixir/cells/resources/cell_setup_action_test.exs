defmodule HiveServerElixir.Cells.Resources.CellSetupActionTest do
  use HiveServerElixir.DataCase, async: false

  import Ash.Expr
  require Ash.Query

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.AgentSession
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Provisioning
  alias HiveServerElixir.Cells.Workspace

  test "prepare_setup_attempt creates provisioning and agent session state" do
    cell = cell!("setup-prepare", "stopped")

    assert {:ok, updated_cell} =
             cell
             |> Ash.Changeset.for_update(:prepare_setup_attempt, %{start_mode: "build"})
             |> Ash.update(domain: Cells)

    assert updated_cell.status == :provisioning
    assert updated_cell.resume_agent_session_on_startup == true
    assert is_binary(updated_cell.opencode_session_id)

    assert {:ok, provisioning} = provisioning_for_cell(updated_cell.id)
    assert provisioning.attempt_count == 1
    assert provisioning.start_mode == "build"
    assert %DateTime{} = provisioning.started_at
    assert provisioning.finished_at == nil

    assert {:ok, session} = session_for_cell(updated_cell.id)
    assert session.session_id == updated_cell.opencode_session_id
    assert session.start_mode == "build"
    assert session.current_mode == "build"
    assert session.resume_on_startup == true
  end

  test "prepare_setup_attempt reuses persisted session identity when cell is missing one" do
    cell = cell!("setup-reuse-session", "error", "stale")

    assert {:ok, _provisioning} =
             Ash.create(
               Provisioning,
               %{cell_id: cell.id, attempt_count: 2, start_mode: "plan"},
               domain: Cells
             )

    assert {:ok, session} =
             Ash.create(
               AgentSession,
               %{
                 cell_id: cell.id,
                 session_id: "persisted-session",
                 start_mode: "plan",
                 current_mode: "plan",
                 resume_on_startup: false
               },
               action: :begin_session,
               domain: Cells
             )

    assert {:ok, updated_cell} =
             cell
             |> Ash.Changeset.for_update(:prepare_setup_attempt, %{})
             |> Ash.update(domain: Cells)

    assert updated_cell.status == :provisioning
    assert updated_cell.last_setup_error == nil
    assert updated_cell.opencode_session_id == "persisted-session"

    assert {:ok, provisioning} = provisioning_for_cell(updated_cell.id)
    assert provisioning.attempt_count == 3

    assert {:ok, refreshed_session} = Ash.get(AgentSession, session.id, domain: Cells)
    assert refreshed_session.resume_on_startup == true
  end

  test "finalize_setup_attempt marks errors and finishes provisioning" do
    cell = cell!("setup-finalize", "provisioning")

    assert {:ok, _prepared_cell} =
             cell
             |> Ash.Changeset.for_update(:prepare_setup_attempt, %{start_mode: "plan"})
             |> Ash.update(domain: Cells)

    assert {:ok, updated_cell} =
             cell
             |> Ash.Changeset.for_update(
               :finalize_setup_attempt,
               %{last_setup_error: "template failed", result: "error"}
             )
             |> Ash.update(domain: Cells)

    assert updated_cell.status == :error
    assert updated_cell.last_setup_error == "template failed"

    assert {:ok, provisioning} = provisioning_for_cell(updated_cell.id)
    assert %DateTime{} = provisioning.finished_at
  end

  defp workspace!(suffix) do
    assert {:ok, workspace} =
             Ash.create(
               Workspace,
               %{path: "/tmp/workspace-#{suffix}", label: "Workspace #{suffix}"},
               domain: Cells
             )

    workspace
  end

  defp cell!(suffix, status, last_setup_error \\ nil) do
    workspace = workspace!(suffix)

    assert {:ok, cell} =
             Ash.create(
               Cell,
               %{
                 workspace_id: workspace.id,
                 description: "Cell #{suffix}",
                 status: status,
                 last_setup_error: last_setup_error
               },
               domain: Cells
             )

    cell
  end

  defp provisioning_for_cell(cell_id) do
    Provisioning
    |> Ash.Query.filter(expr(cell_id == ^cell_id))
    |> Ash.read_one(domain: Cells)
  end

  defp session_for_cell(cell_id) do
    AgentSession
    |> Ash.Query.filter(expr(cell_id == ^cell_id))
    |> Ash.read_one(domain: Cells)
  end
end

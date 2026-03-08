defmodule HiveServerElixir.Cells.ResourcesTest do
  use HiveServerElixir.DataCase, async: false

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Activity
  alias HiveServerElixir.Cells.AgentSession
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Provisioning
  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.Timing
  alias HiveServerElixir.Cells.Workspace

  test "models provisioning, service, agent session, activity, and timing resources" do
    workspace = workspace!()
    cell = cell!(workspace.id)

    assert {:ok, provisioning} =
             Ash.create(
               Provisioning,
               %{cell_id: cell.id, attempt_count: 2, start_mode: "build"},
               domain: Cells
             )

    assert provisioning.cell_id == cell.id
    assert provisioning.attempt_count == 2

    assert {:ok, service} =
             Ash.create(
               Service,
               %{
                 cell_id: cell.id,
                 name: "api",
                 type: "process",
                 command: "bun run dev",
                 cwd: "/tmp/worktree",
                 env: %{"PORT" => "3000"},
                 definition: %{"name" => "api"}
               },
               domain: Cells
             )

    assert service.cell_id == cell.id
    assert service.status == :stopped

    assert {:ok, agent_session} =
             Ash.create(
               AgentSession,
               %{cell_id: cell.id, session_id: "session-1", current_mode: "build"},
               domain: Cells
             )

    assert agent_session.cell_id == cell.id
    assert agent_session.session_id == "session-1"

    assert {:ok, activity} =
             Ash.create(
               Activity,
               %{
                 cell_id: cell.id,
                 service_id: service.id,
                 type: "service.restart",
                 metadata: %{"source" => "test"}
               },
               domain: Cells
             )

    assert activity.cell_id == cell.id

    assert {:ok, timing} =
             Ash.create(
               Timing,
               %{
                 cell_id: cell.id,
                 workflow: "create",
                 run_id: "run-1",
                 step: "ensure_services",
                 status: "ok",
                 duration_ms: 15,
                 metadata: %{"attempt" => 1}
               },
               domain: Cells
             )

    assert timing.cell_id == cell.id
    assert timing.workflow == "create"
  end

  defp workspace! do
    assert {:ok, workspace} =
             Ash.create(
               Workspace,
               %{path: "/tmp/resource-model-workspace", label: "Resource Model"},
               domain: Cells
             )

    workspace
  end

  defp cell!(workspace_id) do
    assert {:ok, cell} =
             Ash.create(
               Cell,
               %{workspace_id: workspace_id, description: "resource model", status: "ready"},
               domain: Cells
             )

    cell
  end
end

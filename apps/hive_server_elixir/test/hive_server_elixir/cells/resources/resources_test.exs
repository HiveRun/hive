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
    provisioning_id = provisioning.id
    assert %Provisioning{id: ^provisioning_id} = Provisioning.fetch_for_cell(cell.id)

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
    service_id = service.id
    assert [%Service{id: ^service_id}] = Service.list_for_cell(cell.id)

    assert [service_snapshot] = Service.snapshot_payloads_for_cell(cell.id)
    assert service_snapshot.id == service.id
    assert service_snapshot.cellId == cell.id
    assert service_snapshot.status == "stopped"

    sampled_at = DateTime.utc_now() |> DateTime.truncate(:second) |> DateTime.to_iso8601()
    process_payload = Service.process_summary_payload(service, sampled_at)
    assert process_payload.id == service.id
    assert process_payload.kind == "service"
    assert process_payload.status == "stopped"
    assert process_payload.resourceSampledAt == sampled_at

    assert {:ok, agent_session} =
             Ash.create(
               AgentSession,
               %{cell_id: cell.id, session_id: "session-1", current_mode: "build"},
               domain: Cells
             )

    assert agent_session.cell_id == cell.id
    assert agent_session.session_id == "session-1"
    agent_session_id = agent_session.id
    assert %AgentSession{id: ^agent_session_id} = AgentSession.fetch_for_cell(cell.id)

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
    activity_id = activity.id
    assert %Activity{id: ^activity_id} = Activity.latest_for_cell(cell.id)

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
    timing_id = timing.id
    assert %Timing{id: ^timing_id} = Timing.latest_for_cell(cell.id)
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

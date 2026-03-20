defmodule HiveServerElixir.Cells.Reactors.CellLifecycleReactorsTest do
  use HiveServerElixir.DataCase, async: false

  import Ash.Expr
  require Ash.Query

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.AgentSession
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.CellCommands
  alias HiveServerElixir.Cells.Lifecycle
  alias HiveServerElixir.Cells.Provisioning
  alias HiveServerElixir.Cells.ProvisioningWorker
  alias HiveServerElixir.Cells.Workspace
  alias HiveServerElixir.OpencodeFakeServer

  @registry HiveServerElixir.Opencode.EventIngestRegistry

  setup do
    {:ok, opencode: OpencodeFakeServer.setup_open_code_stub()}
  end

  test "retry_cell returns provisioning and completes asynchronously", %{opencode: opencode} do
    {workspace, cell} = workspace_and_cell!("retry-success", "error")
    context = %{workspace_id: workspace.id, cell_id: cell.id}

    assert {:ok, old_pid} = Lifecycle.on_cell_create(context, runtime_opts(opencode))

    assert {:ok, updated_cell} =
             CellCommands.retry(%{
               cell_id: cell.id,
               runtime_opts: runtime_opts(opencode),
               fail_after_ingest: false
             })

    assert updated_cell.status == :provisioning

    assert {:ok, _finalized_cell} =
             ProvisioningWorker.run_once(
               cell_id: cell.id,
               mode: :retry,
               runtime_opts: runtime_opts(opencode),
               fail_after_ingest: false
             )

    assert {:ok, refreshed_cell} = Ash.get(Cell, cell.id, domain: Cells)
    assert refreshed_cell.status == :ready
    assert [{new_pid, _value}] = Registry.lookup(@registry, {workspace.id, cell.id})
    refute old_pid == new_pid

    assert :ok = Lifecycle.on_cell_delete(context)
  end

  test "resume_cell returns provisioning and completes asynchronously", %{opencode: opencode} do
    {workspace, cell} = workspace_and_cell!("resume-success", "stopped", "stale setup error")
    context = %{workspace_id: workspace.id, cell_id: cell.id}

    assert {:ok, _provisioning} =
             Ash.create(
               Provisioning,
               %{cell_id: cell.id, attempt_count: 2},
               domain: Cells
             )

    assert {:ok, _pid} = Lifecycle.on_cell_create(context, runtime_opts(opencode))
    assert :ok = Lifecycle.on_cell_delete(context)

    assert {:ok, updated_cell} =
             CellCommands.resume(%{
               cell_id: cell.id,
               runtime_opts: runtime_opts(opencode),
               fail_after_ingest: false
             })

    assert updated_cell.status == :provisioning

    assert {:ok, _finalized_cell} =
             ProvisioningWorker.run_once(
               cell_id: cell.id,
               mode: :resume,
               runtime_opts: runtime_opts(opencode),
               fail_after_ingest: false
             )

    assert {:ok, refreshed_cell} = Ash.get(Cell, cell.id, domain: Cells)
    assert refreshed_cell.status == :ready
    assert refreshed_cell.last_setup_error == nil
    assert [{_pid, _value}] = Registry.lookup(@registry, {workspace.id, cell.id})

    assert {:ok, provisioning} =
             Provisioning
             |> Ash.Query.filter(expr(cell_id == ^cell.id))
             |> Ash.read_one(domain: Cells)

    assert provisioning.attempt_count == 3
    assert %DateTime{} = provisioning.started_at
    assert %DateTime{} = provisioning.finished_at

    assert :ok = Lifecycle.on_cell_delete(context)
  end

  test "resume_cell restores persisted agent session resume projection", %{opencode: opencode} do
    {workspace, cell} =
      workspace_and_cell!("resume-session", "stopped", nil, %{
        opencode_session_id: "session-resume"
      })

    assert {:ok, session} =
             Ash.create(
               AgentSession,
               %{
                 cell_id: cell.id,
                 session_id: "session-resume",
                 start_mode: "plan",
                 current_mode: "plan",
                 resume_on_startup: false,
                 last_error: "stale"
               },
               action: :begin_session,
               domain: Cells
             )

    assert {:ok, updated_cell} =
             CellCommands.resume(%{
               cell_id: cell.id,
               runtime_opts: runtime_opts(opencode),
               fail_after_ingest: false
             })

    assert updated_cell.status == :provisioning

    assert {:ok, _finalized_cell} =
             ProvisioningWorker.run_once(
               cell_id: cell.id,
               mode: :resume,
               runtime_opts: runtime_opts(opencode),
               fail_after_ingest: false
             )

    assert {:ok, refreshed_session} = Ash.get(AgentSession, session.id, domain: Cells)
    assert refreshed_session.resume_on_startup == true

    assert :ok = Lifecycle.on_cell_delete(%{workspace_id: workspace.id, cell_id: cell.id})
  end

  test "retry_cell finalizes errors asynchronously", %{opencode: opencode} do
    {workspace, cell} = workspace_and_cell!("retry-failure", "error")
    context = %{workspace_id: workspace.id, cell_id: cell.id}

    assert {:ok, updated_cell} =
             CellCommands.retry(%{
               cell_id: cell.id,
               runtime_opts: runtime_opts(opencode),
               fail_after_ingest: true
             })

    assert updated_cell.status == :provisioning

    assert :ok =
             ProvisioningWorker.run_once(
               cell_id: cell.id,
               mode: :retry,
               runtime_opts: runtime_opts(opencode),
               fail_after_ingest: true
             )

    assert {:ok, failed_cell} = Ash.get(Cell, cell.id, domain: Cells)
    assert failed_cell.status == :error
    assert failed_cell.last_setup_error == "forced_failure_after_ingest"

    assert {:ok, provisioning} =
             Provisioning
             |> Ash.Query.filter(expr(cell_id == ^cell.id))
             |> Ash.read_one(domain: Cells)

    assert %DateTime{} = provisioning.finished_at

    assert :ok = Lifecycle.on_cell_delete(context)
    assert_registry_stopped(workspace.id, cell.id)
  end

  test "resume_cell finalizes provisioning attempts when post-ingest checks fail", %{
    opencode: opencode
  } do
    {workspace, cell} = workspace_and_cell!("resume-failure", "stopped")

    assert {:ok, _provisioning} =
             Ash.create(
               Provisioning,
               %{cell_id: cell.id, attempt_count: 4},
               domain: Cells
             )

    assert {:ok, updated_cell} =
             CellCommands.resume(%{
               cell_id: cell.id,
               runtime_opts: runtime_opts(opencode),
               fail_after_ingest: true
             })

    assert updated_cell.status == :provisioning

    assert :ok =
             ProvisioningWorker.run_once(
               cell_id: cell.id,
               mode: :resume,
               runtime_opts: runtime_opts(opencode),
               fail_after_ingest: true
             )

    assert {:ok, failed_cell} = Ash.get(Cell, cell.id, domain: Cells)
    assert failed_cell.status == :error
    assert failed_cell.last_setup_error == "forced_failure_after_ingest"

    assert {:ok, provisioning} =
             Provisioning
             |> Ash.Query.filter(expr(cell_id == ^cell.id))
             |> Ash.read_one(domain: Cells)

    assert provisioning.attempt_count == 5
    assert %DateTime{} = provisioning.started_at
    assert %DateTime{} = provisioning.finished_at

    assert_registry_stopped(workspace.id, cell.id)
  end

  test "delete_cell compensates by restoring ingest when downstream fails", %{opencode: opencode} do
    {workspace, cell} = workspace_and_cell!("delete-failure", "ready")
    context = %{workspace_id: workspace.id, cell_id: cell.id}

    assert {:ok, _pid} = Lifecycle.on_cell_create(context, runtime_opts(opencode))

    assert {:error, _error} =
             CellCommands.delete(%{
               cell_id: cell.id,
               runtime_opts: runtime_opts(opencode),
               fail_after_stop: true
             })

    assert [{_pid, _value}] = Registry.lookup(@registry, {workspace.id, cell.id})
    assert {:ok, %Cell{id: cell_id}} = Ash.get(Cell, cell.id, domain: Cells)
    assert cell_id == cell.id

    assert :ok = Lifecycle.on_cell_delete(context)
  end

  defp workspace_and_cell!(suffix, status, last_setup_error \\ nil, overrides \\ %{}) do
    assert {:ok, workspace} =
             Ash.create(
               Workspace,
               %{path: "/tmp/workspace-#{suffix}", label: "Workspace #{suffix}"},
               domain: Cells
             )

    attrs =
      Map.merge(
        %{
          workspace_id: workspace.id,
          description: "Cell #{suffix}",
          status: status,
          last_setup_error: last_setup_error
        },
        overrides
      )

    assert {:ok, cell} =
             Ash.create(
               Cell,
               attrs,
               domain: Cells
             )

    {workspace, cell}
  end

  defp runtime_opts(opencode) do
    [
      adapter_opts: opencode.adapter_opts,
      success_delay_ms: 30_000,
      error_delay_ms: 30_000
    ]
  end

  defp assert_registry_stopped(workspace_id, cell_id) do
    case Registry.lookup(@registry, {workspace_id, cell_id}) do
      [] ->
        :ok

      [{pid, _value}] ->
        ref = Process.monitor(pid)
        assert_receive {:DOWN, ^ref, :process, ^pid, _reason}, 1_000
        assert_registry_stopped(workspace_id, cell_id)
    end
  end
end

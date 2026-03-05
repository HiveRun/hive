defmodule HiveServerElixir.Cells.Reactors.CellLifecycleReactorsTest do
  use HiveServerElixir.DataCase, async: false

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Lifecycle
  alias HiveServerElixir.Cells.Workspace
  alias HiveServerElixir.Opencode.TestOperations

  @registry HiveServerElixir.Opencode.EventIngestRegistry

  test "retry_cell restarts ingest and marks cell ready" do
    {workspace, cell} = workspace_and_cell!("retry-success", "failed")
    context = %{workspace_id: workspace.id, cell_id: cell.id}

    assert {:ok, old_pid} = Lifecycle.on_cell_create(context, runtime_opts())

    assert {:ok, updated_cell} =
             Cells.retry_cell(%{
               cell_id: cell.id,
               runtime_opts: runtime_opts(),
               fail_after_ingest: false
             })

    assert updated_cell.status == "ready"
    assert [{new_pid, _value}] = Registry.lookup(@registry, {workspace.id, cell.id})
    refute old_pid == new_pid

    assert :ok = Lifecycle.on_cell_delete(context)
  end

  test "resume_cell starts ingest when cell is stopped" do
    {workspace, cell} = workspace_and_cell!("resume-success", "paused")
    context = %{workspace_id: workspace.id, cell_id: cell.id}

    assert {:ok, _pid} = Lifecycle.on_cell_create(context, runtime_opts())
    assert :ok = Lifecycle.on_cell_delete(context)

    assert {:ok, updated_cell} =
             Cells.resume_cell(%{
               cell_id: cell.id,
               runtime_opts: runtime_opts(),
               fail_after_ingest: false
             })

    assert updated_cell.status == "ready"
    assert [{_pid, _value}] = Registry.lookup(@registry, {workspace.id, cell.id})

    assert :ok = Lifecycle.on_cell_delete(context)
  end

  test "retry_cell compensates by stopping ingest on failure" do
    {workspace, cell} = workspace_and_cell!("retry-failure", "failed")

    assert {:error, _error} =
             Cells.retry_cell(%{
               cell_id: cell.id,
               runtime_opts: runtime_opts(),
               fail_after_ingest: true
             })

    case Registry.lookup(@registry, {workspace.id, cell.id}) do
      [] ->
        :ok

      [{pid, _value}] ->
        ref = Process.monitor(pid)
        assert_receive {:DOWN, ^ref, :process, ^pid, _reason}
    end

    assert [] = Registry.lookup(@registry, {workspace.id, cell.id})
  end

  test "delete_cell compensates by restoring ingest when downstream fails" do
    {workspace, cell} = workspace_and_cell!("delete-failure", "ready")
    context = %{workspace_id: workspace.id, cell_id: cell.id}

    assert {:ok, _pid} = Lifecycle.on_cell_create(context, runtime_opts())

    assert {:error, _error} =
             Cells.delete_cell(%{
               cell_id: cell.id,
               runtime_opts: runtime_opts(),
               fail_after_stop: true
             })

    assert [{_pid, _value}] = Registry.lookup(@registry, {workspace.id, cell.id})
    assert {:ok, %Cell{id: cell_id}} = Ash.get(Cell, cell.id, domain: Cells)
    assert cell_id == cell.id

    assert :ok = Lifecycle.on_cell_delete(context)
  end

  defp workspace_and_cell!(suffix, status) do
    assert {:ok, workspace} =
             Ash.create(
               Workspace,
               %{path: "/tmp/workspace-#{suffix}", label: "Workspace #{suffix}"},
               domain: Cells
             )

    assert {:ok, cell} =
             Ash.create(
               Cell,
               %{workspace_id: workspace.id, description: "Cell #{suffix}", status: status},
               domain: Cells
             )

    {workspace, cell}
  end

  defp runtime_opts do
    [
      adapter_opts: [
        operations_module: TestOperations,
        global_event: fn _opts -> {:error, %{type: :transport, reason: :unreachable}} end
      ],
      success_delay_ms: 30_000,
      error_delay_ms: 30_000
    ]
  end
end

defmodule HiveServerElixir.Cells.LifecycleTest do
  use ExUnit.Case, async: false

  alias HiveServerElixir.Cells.Lifecycle
  alias HiveServerElixir.Opencode.TestOperations

  @registry HiveServerElixir.Opencode.EventIngestRegistry

  test "on_cell_create starts ingest stream for the cell" do
    context = %{workspace_id: "workspace-create", cell_id: "cell-create"}

    assert {:ok, pid} = Lifecycle.on_cell_create(context, runtime_opts())
    assert [{^pid, _value}] = Registry.lookup(@registry, {"workspace-create", "cell-create"})

    assert :ok = Lifecycle.on_cell_delete(context)
  end

  test "on_cell_retry restarts ingest stream" do
    context = %{workspace_id: "workspace-retry", cell_id: "cell-retry"}

    assert {:ok, old_pid} = Lifecycle.on_cell_create(context, runtime_opts())
    old_ref = Process.monitor(old_pid)

    assert {:ok, new_pid} = Lifecycle.on_cell_retry(context, runtime_opts())
    assert_receive {:DOWN, ^old_ref, :process, ^old_pid, _reason}
    assert new_pid != old_pid

    assert [{^new_pid, _value}] = Registry.lookup(@registry, {"workspace-retry", "cell-retry"})
    assert :ok = Lifecycle.on_cell_delete(context)
  end

  test "on_cell_resume restarts ingest stream" do
    context = %{workspace_id: "workspace-resume", cell_id: "cell-resume"}

    assert {:ok, old_pid} = Lifecycle.on_cell_create(context, runtime_opts())
    old_ref = Process.monitor(old_pid)

    assert {:ok, new_pid} = Lifecycle.on_cell_resume(context, runtime_opts())
    assert_receive {:DOWN, ^old_ref, :process, ^old_pid, _reason}
    assert new_pid != old_pid

    assert [{^new_pid, _value}] = Registry.lookup(@registry, {"workspace-resume", "cell-resume"})
    assert :ok = Lifecycle.on_cell_delete(context)
  end

  test "on_cell_delete is idempotent" do
    context = %{workspace_id: "workspace-delete", cell_id: "cell-delete"}

    assert {:ok, pid} = Lifecycle.on_cell_create(context, runtime_opts())
    ref = Process.monitor(pid)

    assert :ok = Lifecycle.on_cell_delete(context)
    assert_receive {:DOWN, ^ref, :process, ^pid, _reason}
    assert :ok = Lifecycle.on_cell_delete(context)
  end

  defp runtime_opts do
    [
      adapter_opts: [
        operations_module: TestOperations,
        global_event: fn _opts -> {:error, %{type: :transport, reason: :unreachable}} end
      ],
      success_delay_ms: 0,
      error_delay_ms: 30_000
    ]
  end
end

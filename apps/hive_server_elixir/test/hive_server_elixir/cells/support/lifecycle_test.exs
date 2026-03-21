defmodule HiveServerElixir.Cells.LifecycleTest do
  use HiveServerElixir.DataCase, async: false

  alias HiveServerElixir.Cells.Events
  alias HiveServerElixir.Cells.Lifecycle
  alias HiveServerElixir.Cells.TerminalRuntime
  alias HiveServerElixir.Opencode.AgentEventLog

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

  test "handle_start_stream_result emits setup terminal failures for restart errors" do
    cell_id = "cell-restart-error-" <> Ash.UUID.generate()
    context = %{workspace_id: "workspace-restart-error", cell_id: cell_id}

    assert :ok = Events.subscribe_setup_terminal(cell_id)

    assert {:error, :ingest_unavailable} =
             Lifecycle.handle_start_stream_result({:error, :ingest_unavailable}, context)

    assert_receive {:setup_terminal_error, %{cell_id: ^cell_id, message: ":ingest_unavailable"}}

    assert_receive {:setup_terminal_exit, %{cell_id: ^cell_id, exit_code: 1, signal: nil}}

    assert ["[hive] provisioning failed: :ingest_unavailable\n"] =
             TerminalRuntime.read_setup_output(cell_id)

    assert :ok = TerminalRuntime.clear_cell(cell_id)
  end

  test "on_cell_delete is idempotent" do
    context = %{workspace_id: "workspace-delete", cell_id: "cell-delete"}

    assert {:ok, pid} = Lifecycle.on_cell_create(context, runtime_opts())
    ref = Process.monitor(pid)

    assert :ok = Lifecycle.on_cell_delete(context)
    assert_receive {:DOWN, ^ref, :process, ^pid, _reason}
    assert :ok = Lifecycle.on_cell_delete(context)
  end

  test "lifecycle hooks ingest and persist events across create and retry" do
    context = %{workspace_id: "workspace-flow", cell_id: "cell-flow"}

    queue = :queue.from_list([event_payload("session.idle"), event_payload("session.status")])
    queue_pid = start_supervised!({Agent, fn -> queue end})
    adapter_opts = queue_adapter_opts(queue_pid, self())

    assert {:ok, _pid} =
             Lifecycle.on_cell_create(
               context,
               runtime_opts(adapter_opts,
                 success_delay_ms: 30_000,
                 error_delay_ms: 30_000
               )
             )

    assert_receive {:persisted, {:ok, first}}, 1_000
    assert first.session_id == "session-lifecycle"
    assert first.seq == 1
    assert first.event_type == "session.idle"

    assert {:ok, _pid} =
             Lifecycle.on_cell_retry(
               context,
               runtime_opts(adapter_opts,
                 success_delay_ms: 30_000,
                 error_delay_ms: 30_000
               )
             )

    assert_receive {:persisted, {:ok, second}}, 1_000
    assert second.session_id == "session-lifecycle"
    assert second.seq == 2
    assert second.event_type == "session.status"

    assert [stored_first, stored_second] =
             AgentEventLog.list_session_timeline("session-lifecycle")

    assert stored_first.seq == 1
    assert stored_second.seq == 2

    assert :ok = Lifecycle.on_cell_delete(context)
  end

  defp runtime_opts(adapter_opts \\ nil, overrides \\ []) do
    adapter_opts =
      adapter_opts ||
        [global_event: fn _opts -> {:error, %{type: :transport, reason: :unreachable}} end]

    [
      adapter_opts: adapter_opts,
      success_delay_ms: 0,
      error_delay_ms: 30_000
    ]
    |> Keyword.merge(overrides)
  end

  defp queue_adapter_opts(queue_pid, test_pid) do
    [
      global_event: fn _opts ->
        Agent.get_and_update(queue_pid, fn queue ->
          case :queue.out(queue) do
            {{:value, item}, rest} -> {{:ok, item}, rest}
            {:empty, _queue} -> {{:error, %{type: :transport, reason: :empty_queue}}, queue}
          end
        end)
      end,
      persist_global_event: fn event, persist_context ->
        result = AgentEventLog.append_global_event(event, persist_context)
        send(test_pid, {:persisted, result})
        result
      end
    ]
  end

  defp event_payload(type) do
    %{
      "directory" => "/tmp/project",
      "payload" => %{
        "type" => type,
        "properties" => %{"sessionID" => "session-lifecycle"}
      }
    }
  end
end

defmodule HiveServerElixir.Opencode.EventIngestRuntimeTest do
  use HiveServerElixir.DataCase, async: false

  alias HiveServerElixir.Opencode.AgentEventLog
  alias HiveServerElixir.Opencode.EventIngestRuntime
  alias HiveServerElixir.Opencode.TestOperations

  test "start_stream ingests continuously and stop_stream terminates worker" do
    test_pid = self()
    context = %{workspace_id: "workspace-1", cell_id: "cell-1"}

    queue_pid =
      start_supervised!(
        {Agent,
         fn ->
           [
             global_event_payload(type: "session.idle", session_id: "session-runtime", step: 1),
             global_event_payload(type: "session.status", session_id: "session-runtime", step: 2)
           ]
         end}
      )

    adapter_opts = [
      operations_module: TestOperations,
      global_event: fn _opts ->
        Agent.get_and_update(queue_pid, fn
          [next | rest] ->
            send(test_pid, {:fetched, next["payload"]["type"]})
            {{:ok, next}, rest}

          [] ->
            {{:error, %{type: :transport, reason: :empty_queue}}, []}
        end)
      end,
      persist_global_event: fn event, persist_context ->
        result = AgentEventLog.append_global_event(event, persist_context)
        send(test_pid, {:persisted, result})
        result
      end
    ]

    assert {:ok, _pid} =
             EventIngestRuntime.start_stream(
               context,
               adapter_opts: adapter_opts,
               success_delay_ms: 0,
               error_delay_ms: 30_000,
               project_global_event: fn _context, event ->
                 send(test_pid, {:projected, event["payload"]["type"]})
                 :ok
               end
             )

    on_exit(fn ->
      _ = EventIngestRuntime.stop_stream(context)
    end)

    assert_receive {:fetched, "session.idle"}, 1_000
    assert_receive {:persisted, {:ok, _entry}}, 1_000
    assert_receive {:projected, "session.idle"}, 1_000
    assert_receive {:fetched, "session.status"}, 1_000
    assert_receive {:persisted, {:ok, _entry}}, 1_000
    assert_receive {:projected, "session.status"}, 1_000

    assert :ok = EventIngestRuntime.stop_stream(context)

    assert [first, second] = AgentEventLog.list_session_timeline("session-runtime")
    assert first.seq == 1
    assert second.seq == 2
  end

  test "start_stream returns already_started for duplicate context" do
    context = %{workspace_id: "workspace-dup", cell_id: "cell-dup"}

    adapter_opts = [
      operations_module: TestOperations,
      global_event: fn _opts -> {:error, %{type: :transport, reason: :unreachable}} end
    ]

    assert {:ok, _pid} =
             EventIngestRuntime.start_stream(
               context,
               adapter_opts: adapter_opts,
               success_delay_ms: 0,
               error_delay_ms: 30_000
             )

    assert {:error, {:already_started, _pid}} =
             EventIngestRuntime.start_stream(
               context,
               adapter_opts: adapter_opts,
               success_delay_ms: 0,
               error_delay_ms: 30_000
             )

    assert :ok = EventIngestRuntime.stop_stream(context)
  end

  test "stop_stream returns not_found when worker does not exist" do
    assert {:error, :not_found} =
             EventIngestRuntime.stop_stream(%{
               workspace_id: "workspace-none",
               cell_id: "cell-none"
             })
  end

  defp global_event_payload(attrs) do
    attrs = Map.new(attrs)

    %{
      "directory" => "/tmp/project",
      "payload" => %{
        "type" => Map.fetch!(attrs, :type),
        "properties" => %{
          "sessionID" => Map.fetch!(attrs, :session_id),
          "step" => Map.fetch!(attrs, :step)
        }
      }
    }
  end
end

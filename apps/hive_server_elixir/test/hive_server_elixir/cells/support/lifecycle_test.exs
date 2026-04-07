defmodule HiveServerElixir.Cells.LifecycleTest do
  use HiveServerElixir.DataCase, async: false

  alias HiveServerElixir.Cells.Events
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Lifecycle
  alias HiveServerElixir.Cells.TerminalRuntime
  alias HiveServerElixir.Cells.Workspace
  alias HiveServerElixir.Repo

  @registry HiveServerElixir.Opencode.EventIngestRegistry

  setup do
    Ecto.Adapters.SQL.Sandbox.mode(Repo, {:shared, self()})
    :ok
  end

  test "on_cell_create starts ingest stream for the cell" do
    %{context: context} = cell_context!("create", "provisioning")

    assert {:ok, pid} = Lifecycle.on_cell_create(context, runtime_opts())
    assert [{^pid, _value}] = Registry.lookup(@registry, {context.workspace_id, context.cell_id})

    assert :ok = Lifecycle.on_cell_delete(context)
  end

  test "on_cell_retry restarts ingest stream" do
    %{context: context} = cell_context!("retry", "provisioning")

    assert {:ok, old_pid} = Lifecycle.on_cell_create(context, runtime_opts())
    old_ref = Process.monitor(old_pid)

    assert {:ok, new_pid} = Lifecycle.on_cell_retry(context, runtime_opts())
    assert_receive {:DOWN, ^old_ref, :process, ^old_pid, _reason}
    assert new_pid != old_pid

    assert [{^new_pid, _value}] =
             Registry.lookup(@registry, {context.workspace_id, context.cell_id})

    assert :ok = Lifecycle.on_cell_delete(context)
  end

  test "on_cell_resume restarts ingest stream" do
    %{context: context} = cell_context!("resume", "provisioning")

    assert {:ok, old_pid} = Lifecycle.on_cell_create(context, runtime_opts())
    old_ref = Process.monitor(old_pid)

    assert {:ok, new_pid} = Lifecycle.on_cell_resume(context, runtime_opts())
    assert_receive {:DOWN, ^old_ref, :process, ^old_pid, _reason}
    assert new_pid != old_pid

    assert [{^new_pid, _value}] =
             Registry.lookup(@registry, {context.workspace_id, context.cell_id})

    assert :ok = Lifecycle.on_cell_delete(context)
  end

  test "handle_start_stream_result emits setup terminal failures for restart errors" do
    {:ok, workspace} =
      Ash.create(Workspace, %{path: "/tmp/ws-lifecycle-error", label: "Lifecycle Error"})

    {:ok, cell} =
      Ash.create(Cell, %{
        workspace_id: workspace.id,
        name: "Lifecycle cell",
        template_id: "basic",
        workspace_root_path: workspace.path,
        workspace_path: workspace.path,
        opencode_session_id: "session-#{System.unique_integer([:positive])}",
        status: "provisioning"
      })

    cell_id = cell.id
    context = %{workspace_id: workspace.id, cell_id: cell_id}

    assert :ok = Events.subscribe_setup_terminal(cell_id)

    assert {:error, :ingest_unavailable} =
             Lifecycle.handle_start_stream_result({:error, :ingest_unavailable}, context)

    assert_receive {:setup_terminal_error, %{cell_id: ^cell_id, message: ":ingest_unavailable"}}

    assert_receive {:setup_terminal_exit, %{cell_id: ^cell_id, exit_code: 1, signal: nil}}

    assert TerminalRuntime.read_setup_output(cell_id) =~
             "[hive] provisioning failed: :ingest_unavailable\n"

    assert :ok = TerminalRuntime.clear_cell(cell_id)
  end

  test "on_cell_delete is idempotent" do
    %{context: context} = cell_context!("delete", "provisioning")

    assert {:ok, pid} = Lifecycle.on_cell_create(context, runtime_opts())
    ref = Process.monitor(pid)

    assert :ok = Lifecycle.on_cell_delete(context)
    assert_receive {:DOWN, ^ref, :process, ^pid, _reason}
    assert :ok = Lifecycle.on_cell_delete(context)
  end

  test "lifecycle hooks ingest and persist events across create and retry" do
    %{context: context} = cell_context!("flow", "provisioning")

    queue = :queue.from_list([event_payload("session.idle"), event_payload("session.status")])
    queue_pid = Agent.start_link(fn -> queue end) |> elem(1)
    persisted_pid = Agent.start_link(fn -> [] end) |> elem(1)

    on_exit(fn ->
      if Process.alive?(queue_pid), do: Agent.stop(queue_pid)
      if Process.alive?(persisted_pid), do: Agent.stop(persisted_pid)
    end)

    adapter_opts = queue_adapter_opts(queue_pid, persisted_pid, self())

    assert {:ok, _pid} =
             Lifecycle.on_cell_create(
               context,
               runtime_opts(adapter_opts,
                 success_delay_ms: 30_000,
                 error_delay_ms: 30_000
               )
             )

    [{pid, _value}] = Registry.lookup(@registry, {context.workspace_id, context.cell_id})
    Ecto.Adapters.SQL.Sandbox.allow(Repo, self(), pid)

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

    [{pid, _value}] = Registry.lookup(@registry, {context.workspace_id, context.cell_id})
    Ecto.Adapters.SQL.Sandbox.allow(Repo, self(), pid)

    assert_receive {:persisted, {:ok, second}}, 1_000
    assert second.session_id == "session-lifecycle"
    assert second.seq == 2
    assert second.event_type == "session.status"

    stored_events = Agent.get(persisted_pid, & &1)

    assert [stored_first, stored_second] = stored_events

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

  defp queue_adapter_opts(queue_pid, persisted_pid, test_pid) do
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
        persisted =
          Agent.get_and_update(persisted_pid, fn events ->
            next = %{
              session_id: Map.get(persist_context, :session_id) || "session-lifecycle",
              seq: length(events) + 1,
              event_type: get_in(event, ["payload", "type"]) || get_in(event, [:payload, :type])
            }

            {next, events ++ [next]}
          end)

        send(test_pid, {:persisted, {:ok, persisted}})
        {:ok, persisted}
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

  defp cell_context!(suffix, status) do
    path = "/tmp/ws-lifecycle-#{suffix}-#{System.unique_integer([:positive])}"
    File.mkdir_p!(path)

    assert {:ok, workspace} =
             Ash.create(Workspace, %{
               path: path,
               label: "Lifecycle #{suffix}"
             })

    on_exit(fn ->
      _ = File.rm_rf(path)
    end)

    assert {:ok, cell} =
             Ash.create(Cell, %{
               workspace_id: workspace.id,
               name: "Lifecycle #{suffix}",
               template_id: "basic",
               workspace_root_path: workspace.path,
               workspace_path: workspace.path,
               opencode_session_id: "session-#{System.unique_integer([:positive])}",
               resume_agent_session_on_startup: true,
               status: status
             })

    %{context: %{workspace_id: workspace.id, cell_id: cell.id}, workspace: workspace, cell: cell}
  end
end

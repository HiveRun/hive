defmodule HiveServerElixir.Cells.Reactors.CreateCellTest do
  use HiveServerElixir.DataCase, async: false

  import Ash.Expr
  require Ash.Query

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Lifecycle
  alias HiveServerElixir.Cells.Workspace
  alias HiveServerElixir.Opencode.AgentEventLog
  alias HiveServerElixir.Opencode.TestOperations

  @registry HiveServerElixir.Opencode.EventIngestRegistry

  test "creates a ready cell and ingests a persisted event" do
    workspace = workspace!("create")

    queue_pid =
      start_supervised!({Agent, fn -> [event_payload("session.idle", "session-create-cell")] end})

    assert {:ok, cell} =
             Cells.create_cell(%{
               workspace_id: workspace.id,
               description: "Create cell reactor success",
               runtime_opts: runtime_opts(self(), queue_pid),
               fail_after_ingest: false
             })

    on_exit(fn ->
      _ = Lifecycle.on_cell_delete(%{workspace_id: workspace.id, cell_id: cell.id})
    end)

    assert cell.workspace_id == workspace.id
    assert cell.status == :ready
    assert_receive {:persisted, {:ok, persisted}}
    assert persisted.session_id == "session-create-cell"
    assert persisted.seq == 1

    assert [%{event_type: "session.idle", seq: 1}] =
             AgentEventLog.list_session_timeline("session-create-cell")
  end

  test "compensates by stopping ingest when post-start check fails" do
    workspace = workspace!("failure")

    assert {:error, _error} =
             Cells.create_cell(%{
               workspace_id: workspace.id,
               description: "Create cell reactor failure",
               runtime_opts: runtime_opts_without_persist(),
               fail_after_ingest: true
             })

    assert [%{id: cell_id, status: :provisioning}] =
             list_cells_by_description(workspace.id, "Create cell reactor failure")

    assert [] = Registry.lookup(@registry, {workspace.id, cell_id})
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

  defp runtime_opts(test_pid, queue_pid) do
    [
      adapter_opts: [
        operations_module: TestOperations,
        global_event: fn _opts ->
          Agent.get_and_update(queue_pid, fn
            [next | rest] -> {{:ok, next}, rest}
            [] -> {{:error, %{type: :transport, reason: :empty_queue}}, []}
          end)
        end,
        persist_global_event: fn event, persist_context ->
          result = AgentEventLog.append_global_event(event, persist_context)
          send(test_pid, {:persisted, result})
          result
        end
      ],
      success_delay_ms: 30_000,
      error_delay_ms: 30_000
    ]
  end

  defp runtime_opts_without_persist do
    [
      adapter_opts: [
        operations_module: TestOperations,
        global_event: fn _opts -> {:error, %{type: :transport, reason: :unreachable}} end
      ],
      success_delay_ms: 30_000,
      error_delay_ms: 30_000
    ]
  end

  defp event_payload(type, session_id) do
    %{
      "directory" => "/tmp/project",
      "payload" => %{
        "type" => type,
        "properties" => %{"sessionID" => session_id}
      }
    }
  end

  defp list_cells_by_description(workspace_id, description) do
    Cell
    |> Ash.Query.filter(expr(workspace_id == ^workspace_id and description == ^description))
    |> Ash.read!(domain: Cells)
  end
end

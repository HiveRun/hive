defmodule HiveServerElixir.Cells.Reactors.CreateCellTest do
  use HiveServerElixir.DataCase, async: false

  import Ash.Expr
  require Ash.Query

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.CellCommands
  alias HiveServerElixir.Cells.Provisioning
  alias HiveServerElixir.Cells.ProvisioningWorker
  alias HiveServerElixir.Cells.Workspace
  alias HiveServerElixir.Opencode.AgentEventLog

  @registry HiveServerElixir.Opencode.EventIngestRegistry

  test "creates a provisioning cell immediately and completes setup asynchronously" do
    workspace = workspace!("create")

    assert {:ok, cell} =
             CellCommands.create(%{
               workspace_id: workspace.id,
               description: "Create cell reactor success",
               runtime_opts: runtime_opts(self()),
               fail_after_ingest: false
             })

    assert cell.workspace_id == workspace.id
    assert cell.status == :provisioning

    assert {:ok, _finalized_cell} =
             ProvisioningWorker.run_once(
               cell_id: cell.id,
               mode: :create,
               runtime_opts: runtime_opts(self()),
               fail_after_ingest: false
             )

    assert {:ok, refreshed_cell} = Ash.get(Cell, cell.id, domain: Cells)
    assert refreshed_cell.status == :ready

    assert_receive {:persisted, {:ok, persisted}}, 1_000
    assert persisted.session_id == "session-create-cell"
    assert persisted.seq == 1

    assert [%{event_type: "session.idle", seq: 1}] =
             AgentEventLog.list_session_timeline("session-create-cell")

    assert :ok =
             HiveServerElixir.Opencode.EventIngestRuntime.stop_stream(%{
               workspace_id: workspace.id,
               cell_id: cell.id
             })
  end

  test "returns provisioning immediately and finalizes errors asynchronously" do
    workspace = workspace!("failure")

    assert {:ok, cell} =
             CellCommands.create(%{
               workspace_id: workspace.id,
               description: "Create cell reactor failure",
               runtime_opts: runtime_opts_without_persist(),
               fail_after_ingest: true
             })

    assert cell.status == :provisioning

    assert :ok =
             ProvisioningWorker.run_once(
               cell_id: cell.id,
               mode: :create,
               runtime_opts: runtime_opts_without_persist(),
               fail_after_ingest: true
             )

    assert [%{id: cell_id, status: :error, last_setup_error: "forced_failure_after_ingest"}] =
             list_cells_by_description(workspace.id, "Create cell reactor failure")

    assert {:ok, provisioning} =
             Provisioning
             |> Ash.Query.filter(expr(cell_id == ^cell_id))
             |> Ash.read_one(domain: Cells)

    assert %DateTime{} = provisioning.finished_at

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

  defp runtime_opts(test_pid) do
    [
      adapter_opts: [
        global_event: fn _opts -> {:ok, event_payload("session.idle", "session-create-cell")} end,
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

defmodule HiveServerElixir.Cells.Reactors.EnsureIngestRunningTest do
  use HiveServerElixir.DataCase, async: false

  alias HiveServerElixir.Cells.Lifecycle
  alias HiveServerElixir.Cells.Reactors.EnsureIngestRunning

  @registry HiveServerElixir.Opencode.EventIngestRegistry

  test "runs successfully and keeps ingest worker alive" do
    context = ingest_context!("success")
    on_exit(fn -> _ = Lifecycle.on_cell_delete(context) end)

    assert {:ok, %{context: ^context, pid: pid}} =
             Reactor.run(EnsureIngestRunning, %{
               context: context,
               runtime_opts: runtime_opts(),
               fail_after_start: false
             })

    assert [{^pid, _value}] = Registry.lookup(@registry, {context.workspace_id, context.cell_id})
  end

  test "compensates by stopping ingest when downstream step fails" do
    context = ingest_context!("failure")

    assert {:error, _error} =
             Reactor.run(EnsureIngestRunning, %{
               context: context,
               runtime_opts: runtime_opts(),
               fail_after_start: true
             })

    case Registry.lookup(@registry, {"workspace-reactor-failure", "cell-reactor-failure"}) do
      [] ->
        :ok

      [{pid, _value}] ->
        ref = Process.monitor(pid)
        assert_receive {:DOWN, ^ref, :process, ^pid, _reason}, 1_000

        assert [] =
                 Registry.lookup(@registry, {"workspace-reactor-failure", "cell-reactor-failure"})
    end
  end

  defp runtime_opts do
    [
      adapter_opts: [
        global_event: fn _opts -> {:error, %{type: :transport, reason: :unreachable}} end
      ],
      success_delay_ms: 0,
      error_delay_ms: 30_000
    ]
  end

  defp ingest_context!(suffix) do
    path = "/tmp/ws-reactor-#{suffix}-#{System.unique_integer([:positive])}"
    File.mkdir_p!(path)

    {:ok, workspace} =
      Ash.create(HiveServerElixir.Cells.Workspace, %{path: path, label: "Reactor #{suffix}"})

    {:ok, cell} =
      Ash.create(HiveServerElixir.Cells.Cell, %{
        workspace_id: workspace.id,
        name: "Reactor #{suffix}",
        template_id: "basic",
        workspace_root_path: path,
        workspace_path: path,
        status: "provisioning"
      })

    on_exit(fn ->
      _ = File.rm_rf(path)
    end)

    %{workspace_id: workspace.id, cell_id: cell.id}
  end
end

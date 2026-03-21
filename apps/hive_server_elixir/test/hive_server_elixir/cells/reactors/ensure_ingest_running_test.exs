defmodule HiveServerElixir.Cells.Reactors.EnsureIngestRunningTest do
  use ExUnit.Case, async: false

  alias HiveServerElixir.Cells.Lifecycle
  alias HiveServerElixir.Cells.Reactors.EnsureIngestRunning

  @registry HiveServerElixir.Opencode.EventIngestRegistry

  test "runs successfully and keeps ingest worker alive" do
    context = %{workspace_id: "workspace-reactor-success", cell_id: "cell-reactor-success"}
    on_exit(fn -> _ = Lifecycle.on_cell_delete(context) end)

    assert {:ok, %{context: ^context, pid: pid}} =
             Reactor.run(EnsureIngestRunning, %{
               context: context,
               runtime_opts: runtime_opts(),
               fail_after_start: false
             })

    assert [{^pid, _value}] =
             Registry.lookup(@registry, {"workspace-reactor-success", "cell-reactor-success"})
  end

  test "compensates by stopping ingest when downstream step fails" do
    context = %{workspace_id: "workspace-reactor-failure", cell_id: "cell-reactor-failure"}

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
        assert_receive {:DOWN, ^ref, :process, ^pid, _reason}

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
end

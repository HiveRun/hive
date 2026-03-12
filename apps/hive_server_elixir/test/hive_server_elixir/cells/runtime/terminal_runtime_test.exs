defmodule HiveServerElixir.Cells.TerminalRuntimeTest do
  use HiveServerElixir.DataCase, async: false

  import Ash.Expr
  require Ash.Query

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.TerminalSession
  alias HiveServerElixir.Cells.TerminalRuntime
  alias HiveServerElixir.Cells.Workspace

  test "caps retained terminal history while keeping newest chunks in order" do
    cell_id = Ash.UUID.generate()

    for index <- 1..1_050 do
      :ok = TerminalRuntime.append_setup_output(cell_id, "line-#{index}\n")
    end

    output = TerminalRuntime.read_setup_output(cell_id)

    assert length(output) == 1_000
    assert hd(output) == "line-51\n"
    assert List.last(output) == "line-1050\n"

    :ok = TerminalRuntime.clear_cell(cell_id)
  end

  test "persists setup and service terminal metadata in Ash" do
    {cell, service} = cell_with_service!("terminal-runtime-persist")

    setup_session = TerminalRuntime.ensure_setup_session(cell.id)
    service_session = TerminalRuntime.ensure_service_session(cell.id, service.id)

    assert {:ok, [persisted_setup, persisted_service]} =
             TerminalSession
             |> Ash.Query.filter(expr(cell_id == ^cell.id))
             |> Ash.Query.sort(kind: :asc)
             |> Ash.read(domain: Cells)

    assert Enum.sort([persisted_setup.kind, persisted_service.kind]) == [:service, :setup]

    assert Enum.map([persisted_setup, persisted_service], & &1.runtime_session_id) |> Enum.sort() ==
             Enum.sort([setup_session.sessionId, service_session.sessionId])
  end

  test "clearing a cell marks persisted terminal sessions closed" do
    {cell, service} = cell_with_service!("terminal-runtime-clear")

    _ = TerminalRuntime.ensure_setup_session(cell.id)
    _ = TerminalRuntime.ensure_service_session(cell.id, service.id)

    assert :ok = TerminalRuntime.clear_cell(cell.id)

    assert {:ok, terminal_sessions} =
             TerminalSession
             |> Ash.Query.filter(expr(cell_id == ^cell.id))
             |> Ash.read(domain: Cells)

    assert length(terminal_sessions) == 2
    assert Enum.all?(terminal_sessions, &(&1.status == :closed))
    assert Enum.all?(terminal_sessions, &match?(%DateTime{}, &1.ended_at))
  end

  defp cell_with_service!(suffix) do
    assert {:ok, workspace} =
             Ash.create(
               Workspace,
               %{path: "/tmp/workspace-#{suffix}", label: "Workspace #{suffix}"},
               domain: Cells
             )

    assert {:ok, cell} =
             Ash.create(
               Cell,
               %{workspace_id: workspace.id, description: "Cell #{suffix}", status: "ready"},
               domain: Cells
             )

    assert {:ok, service} =
             Ash.create(
               Service,
               %{
                 cell_id: cell.id,
                 name: "api",
                 type: "process",
                 command: "sleep 5",
                 cwd: "/tmp",
                 env: %{},
                 definition: %{}
               },
               domain: Cells
             )

    {cell, service}
  end
end

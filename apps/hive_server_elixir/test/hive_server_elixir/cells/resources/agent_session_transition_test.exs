defmodule HiveServerElixir.Cells.Resources.AgentSessionTransitionTest do
  use HiveServerElixir.DataCase, async: false

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.AgentSession
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Workspace

  test "begin_session defaults current_mode from start_mode" do
    cell = cell!("agent-session-begin")

    assert {:ok, session} =
             Ash.create(
               AgentSession,
               %{
                 cell_id: cell.id,
                 session_id: "session-begin-#{System.unique_integer([:positive])}",
                 start_mode: "build"
               },
               action: :begin_session,
               domain: Cells
             )

    assert session.start_mode == "build"
    assert session.current_mode == "build"
  end

  test "begin_session rejects invalid lifecycle modes" do
    cell = cell!("agent-session-invalid")

    assert {:error, error} =
             Ash.create(
               AgentSession,
               %{
                 cell_id: cell.id,
                 session_id: "session-invalid-#{System.unique_integer([:positive])}",
                 start_mode: "draft"
               },
               action: :begin_session,
               domain: Cells
             )

    assert Exception.message(error) =~ "must be either 'plan' or 'build'"
  end

  test "set_mode updates current_mode and clears stale errors" do
    session = agent_session!("agent-session-mode", %{last_error: "stale"})

    assert {:ok, updated_session} =
             Ash.update(session, %{mode: "build"}, action: :set_mode, domain: Cells)

    assert updated_session.current_mode == "build"
    assert updated_session.last_error == nil
  end

  test "fetch helpers return persisted sessions by cell and session id" do
    session = agent_session!("agent-session-fetch")

    cell_session = AgentSession.fetch_for_cell(session.cell_id)
    session_lookup = AgentSession.fetch_by_session_id(session.session_id)

    assert %AgentSession{id: cell_session_id} = cell_session
    assert %AgentSession{id: session_lookup_id} = session_lookup
    assert cell_session_id == session.id
    assert session_lookup_id == session.id
  end

  test "agent session lifecycle writes require explicit update actions" do
    session = agent_session!("agent-session-generic")

    assert_raise RuntimeError, ~r/Required primary update action/, fn ->
      Ash.update(session, %{current_mode: "build"}, domain: Cells)
    end
  end

  defp agent_session!(suffix, overrides \\ %{}) do
    cell = cell!(suffix)

    attrs =
      Map.merge(
        %{
          cell_id: cell.id,
          session_id: "session-#{suffix}-#{System.unique_integer([:positive])}",
          start_mode: "plan",
          current_mode: "plan"
        },
        overrides
      )

    assert {:ok, session} = Ash.create(AgentSession, attrs, action: :begin_session, domain: Cells)
    session
  end

  defp cell!(suffix) do
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

    cell
  end
end

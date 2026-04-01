defmodule HiveServerElixir.Cells.TerminalEventsTest do
  use HiveServerElixir.DataCase, async: false

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.AgentSession
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Events
  alias HiveServerElixir.Cells.TerminalEvents
  alias HiveServerElixir.Cells.TerminalRuntime
  alias HiveServerElixir.Cells.Workspace

  test "on_cell_started initializes setup terminal output" do
    workspace = workspace!("terminal-events-started")
    cell = cell!(workspace, "provisioning")
    cell_id = cell.id
    context = %{workspace_id: workspace.id, cell_id: cell_id}

    assert :ok = Events.subscribe_setup_terminal(cell_id)
    assert :ok = TerminalEvents.on_cell_started(context)

    assert_receive {:setup_terminal_data,
                    %{cell_id: ^cell_id, chunk: "[hive] provisioning started\n"}}

    assert TerminalRuntime.read_setup_output(cell_id) =~ "[hive] provisioning started\n"

    assert :ok = TerminalRuntime.clear_cell(cell_id)
  end

  test "on_cell_ready emits completion data and setup exit" do
    workspace = workspace!("terminal-events-ready")
    cell = cell!(workspace, "provisioning")
    cell_id = cell.id
    context = %{workspace_id: workspace.id, cell_id: cell_id}

    assert :ok = Events.subscribe_setup_terminal(cell_id)
    assert :ok = TerminalEvents.on_cell_started(context)
    assert_receive {:setup_terminal_data, %{cell_id: ^cell_id, chunk: _chunk}}

    assert :ok = TerminalEvents.on_cell_ready(context)

    assert_receive {:setup_terminal_data,
                    %{cell_id: ^cell_id, chunk: "[hive] provisioning completed\n"}}

    assert_receive {:setup_terminal_exit, %{cell_id: ^cell_id, exit_code: 0, signal: nil}}

    assert :ok = TerminalRuntime.clear_cell(cell_id)
  end

  test "project_opencode_event forwards session and pty terminal events" do
    workspace = workspace!("terminal-events-errors")
    cell = cell!(workspace, "ready")
    cell_id = cell.id
    context = %{workspace_id: workspace.id, cell_id: cell_id}

    assert :ok = Events.subscribe_chat_terminal(cell_id)

    assert :ok =
             TerminalEvents.project_opencode_event(context, %{
               "payload" => %{
                 "type" => "session.error",
                 "properties" => %{"message" => "agent crashed"}
               }
             })

    assert_receive {:chat_terminal_error, %{cell_id: ^cell_id, message: "agent crashed"}}

    assert :ok = TerminalRuntime.clear_cell(cell_id)
  end

  test "project_opencode_event falls back to nested and default session error messages" do
    workspace = workspace!("terminal-events-nested-errors")
    cell = cell!(workspace, "ready")
    cell_id = cell.id
    context = %{workspace_id: workspace.id, cell_id: cell_id}

    assert :ok = Events.subscribe_chat_terminal(cell_id)

    assert :ok =
             TerminalEvents.project_opencode_event(context, %{
               "payload" => %{
                 "type" => "session.error",
                 "properties" => %{"error" => %{"message" => "nested crash"}}
               }
             })

    assert_receive {:chat_terminal_error, %{cell_id: ^cell_id, message: "nested crash"}}

    assert :ok =
             TerminalEvents.project_opencode_event(context, %{
               "payload" => %{
                 "type" => "session.error",
                 "properties" => %{}
               }
             })

    assert_receive {:chat_terminal_error, %{cell_id: ^cell_id, message: "OpenCode session error"}}

    assert :ok = TerminalRuntime.clear_cell(cell_id)
  end

  test "project_opencode_event persists agent session runtime details and errors" do
    workspace = workspace!("terminal-events-session")
    cell = cell!(workspace, "ready")

    assert {:ok, session} =
             Ash.create(
               AgentSession,
               %{
                 cell_id: cell.id,
                 session_id: "session-#{System.unique_integer([:positive])}",
                 start_mode: "plan",
                 current_mode: "plan",
                 resume_on_startup: false
               },
               action: :begin_session,
               domain: Cells
             )

    assert :ok =
             TerminalEvents.project_opencode_event(
               %{workspace_id: workspace.id, cell_id: cell.id},
               %{
                 "payload" => %{
                   "type" => "session.status",
                   "properties" => %{
                     "sessionID" => session.session_id,
                     "currentMode" => "build",
                     "model" => %{"providerID" => "opencode", "modelID" => "big-pickle"}
                   }
                 }
               }
             )

    assert {:ok, refreshed_session} = Ash.get(AgentSession, session.id, domain: Cells)
    assert refreshed_session.current_mode == "build"
    assert refreshed_session.model_provider_id == "opencode"
    assert refreshed_session.model_id == "big-pickle"
    assert refreshed_session.resume_on_startup == true

    assert :ok =
             TerminalEvents.project_opencode_event(
               %{workspace_id: workspace.id, cell_id: cell.id},
               %{
                 "payload" => %{
                   "type" => "session.error",
                   "properties" => %{
                     "sessionID" => session.session_id,
                     "message" => "agent crashed"
                   }
                 }
               }
             )

    assert {:ok, errored_session} = Ash.get(AgentSession, session.id, domain: Cells)
    assert errored_session.last_error == "agent crashed"
  end

  test "on_cell_stopped emits terminal exits and clears buffered output" do
    workspace = workspace!("terminal-events-stopped")
    cell = cell!(workspace, "ready")
    cell_id = cell.id
    context = %{workspace_id: workspace.id, cell_id: cell_id}

    assert :ok = Events.subscribe_setup_terminal(cell_id)
    assert :ok = Events.subscribe_chat_terminal(cell_id)

    assert :ok = TerminalEvents.on_cell_started(context)
    assert_receive {:setup_terminal_data, %{cell_id: ^cell_id, chunk: _chunk}}

    :ok = TerminalRuntime.append_chat_output(cell_id, "prior")
    assert TerminalRuntime.read_chat_output(cell_id) == "prior"

    assert :ok = TerminalEvents.on_cell_stopped(context)

    assert_receive {:setup_terminal_exit, %{cell_id: ^cell_id, exit_code: 0, signal: nil}}
    assert_receive {:chat_terminal_exit, %{cell_id: ^cell_id, exit_code: 0, signal: nil}}
    assert TerminalRuntime.read_setup_output(cell_id) == ""
    assert TerminalRuntime.read_chat_output(cell_id) == ""
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

  defp cell!(workspace, status) do
    assert {:ok, cell} =
             Ash.create(
               Cell,
               %{
                 workspace_id: workspace.id,
                 name: "Cell",
                 template_id: "basic",
                 workspace_root_path: workspace.path,
                 workspace_path: workspace.path,
                 opencode_session_id: "session-#{System.unique_integer([:positive])}",
                 resume_agent_session_on_startup: true,
                 status: status
               },
               domain: Cells
             )

    cell
  end
end

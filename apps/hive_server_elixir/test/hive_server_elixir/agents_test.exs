defmodule HiveServerElixir.AgentsTest do
  use HiveServerElixir.DataCase

  alias HiveServerElixir.Agents
  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.AgentSession
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.TerminalRuntime
  alias HiveServerElixir.Cells.Workspace
  alias HiveServerElixir.Opencode.AgentEventLog
  alias HiveServerElixir.Opencode.TestClient
  alias HiveServerElixir.Workspaces

  setup do
    previous_active_workspace_id = Workspaces.active_workspace_id()
    previous_client = Application.get_env(:hive_server_elixir, :opencode_client)
    previous_client_opts = Application.get_env(:hive_server_elixir, :opencode_client_opts)

    Application.put_env(:hive_server_elixir, :opencode_client, TestClient)
    Application.delete_env(:hive_server_elixir, :opencode_client_opts)
    :ok = Workspaces.set_active_workspace_id(nil)

    on_exit(fn ->
      :ok = Workspaces.set_active_workspace_id(previous_active_workspace_id)

      restore_env(:opencode_client, previous_client)
      restore_env(:opencode_client_opts, previous_client_opts)
    end)

    :ok
  end

  test "provider_payload_for_workspace returns normalized catalog payload" do
    workspace = workspace!("agents-domain-models")

    assert {:ok, payload} = Agents.provider_payload_for_workspace(workspace.id)
    assert payload.defaults == %{"opencode" => "big-pickle"}
    assert Enum.any?(payload.providers, &(&1.id == "opencode"))
    assert Enum.any?(payload.models, &(&1.id == "big-pickle" and &1.provider == "opencode"))
  end

  test "session_payload_for_cell falls back to persisted event session context" do
    workspace = workspace!("agents-domain-session-fallback")
    cell = cell!(workspace, "ready")

    assert {:ok, _event} =
             AgentEventLog.append(%{
               workspace_id: workspace.id,
               cell_id: cell.id,
               session_id: "session-fallback-1",
               seq: 1,
               event_type: "session.idle",
               payload: %{"payload" => %{"type" => "session.idle"}}
             })

    assert {:ok, payload} = Agents.session_payload_for_cell(cell.id)
    assert payload.id == "session-fallback-1"
    assert payload.cellId == cell.id
    assert payload.status == "awaiting_input"
  end

  test "messages_payload_for_session falls back to terminal output when session fetch fails" do
    workspace = workspace!("agents-domain-messages-fallback")
    cell = cell!(workspace, "ready")
    session = agent_session!(cell)

    Application.put_env(
      :hive_server_elixir,
      :opencode_client_opts,
      test_client_callback: fn _operation -> {:error, %{status: 404, body: %{}}} end
    )

    :ok = TerminalRuntime.append_chat_output(cell.id, "Need a summary")

    assert {:ok, %{messages: [user_message, assistant_message]}} =
             Agents.messages_payload_for_session(session.session_id)

    assert user_message.role == "user"
    assert user_message.content == "Need a summary"
    assert assistant_message.role == "assistant"
    assert assistant_message.content == "Need a summary"
  end

  defp workspace!(suffix) do
    workspace_path = tmp_workspace_path!(suffix)

    assert {:ok, workspace} =
             Ash.create(
               Workspace,
               %{path: workspace_path, label: "Workspace #{suffix}"},
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
                 name: "Agent Cell",
                 template_id: "basic",
                 workspace_root_path: workspace.path,
                 workspace_path: workspace.path,
                 status: status
               },
               domain: Cells
             )

    cell
  end

  defp agent_session!(cell) do
    assert {:ok, session} =
             Ash.create(
               AgentSession,
               %{
                 cell_id: cell.id,
                 session_id: "session-#{System.unique_integer([:positive])}",
                 model_id: "big-pickle",
                 model_provider_id: "opencode",
                 start_mode: "plan",
                 current_mode: "build"
               },
               domain: Cells
             )

    session
  end

  defp tmp_workspace_path!(suffix) do
    path =
      Path.join(
        System.tmp_dir!(),
        "hive-agents-domain-#{suffix}-#{System.unique_integer([:positive])}"
      )

    File.mkdir_p!(path)
    File.write!(Path.join(path, "hive.config.json"), "{}")

    on_exit(fn ->
      File.rm_rf!(path)
    end)

    path
  end

  defp restore_env(key, nil), do: Application.delete_env(:hive_server_elixir, key)
  defp restore_env(key, value), do: Application.put_env(:hive_server_elixir, key, value)
end

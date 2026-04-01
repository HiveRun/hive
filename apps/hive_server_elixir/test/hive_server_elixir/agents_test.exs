defmodule HiveServerElixir.AgentsTest do
  use HiveServerElixir.DataCase

  alias HiveServerElixir.Agents
  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.AgentSession
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Workspace
  alias HiveServerElixir.Opencode.AgentEventLog
  alias HiveServerElixir.OpencodeRealServer
  alias HiveServerElixir.Workspaces

  setup_all do
    server = OpencodeRealServer.start!()

    on_exit(fn ->
      OpencodeRealServer.stop(server)
    end)

    {:ok, opencode_server: server}
  end

  setup %{opencode_server: server} do
    previous_active_workspace_id = Workspaces.active_workspace_id()
    previous_base_url = Application.get_env(:hive_server_elixir, :opencode_base_url)
    previous_client_opts = Application.get_env(:hive_server_elixir, :opencode_client_opts)

    Application.put_env(:hive_server_elixir, :opencode_base_url, server.url)
    Application.delete_env(:hive_server_elixir, :opencode_client_opts)
    :ok = Workspaces.set_active_workspace_id(nil)

    on_exit(fn ->
      :ok = Workspaces.set_active_workspace_id(previous_active_workspace_id)
      restore_env(:opencode_base_url, previous_base_url)
      restore_env(:opencode_client_opts, previous_client_opts)
    end)

    {:ok, opencode_server: server}
  end

  test "provider_payload_for_workspace returns normalized catalog payload" do
    workspace = workspace!("agents-domain-models")

    assert {:ok, payload} = Agents.provider_payload_for_workspace(workspace.id)
    assert payload.defaults["opencode"] == "big-pickle"
    assert Enum.any?(payload.providers, &(&1.id == "opencode"))
    assert Enum.any?(payload.models, &(&1.id == "big-pickle" and &1.provider == "opencode"))
  end

  test "provider_payload_for_session resolves workspace path through the real client transport" do
    workspace = workspace!("agents-domain-session-models")
    cell = cell!(workspace, "ready")
    session = agent_session!(cell)

    assert {:ok, payload} = Agents.provider_payload_for_session(session.session_id)
    assert payload.defaults["opencode"] == "big-pickle"
  end

  test "provider_payload_for_workspace surfaces transport-backed errors" do
    previous_base_url = Application.get_env(:hive_server_elixir, :opencode_base_url)
    workspace = workspace!("agents-domain-models-error")

    Application.put_env(:hive_server_elixir, :opencode_base_url, "http://127.0.0.1:1")

    on_exit(fn ->
      restore_env(:opencode_base_url, previous_base_url)
    end)

    assert {:error, {:bad_request, message}} =
             Agents.provider_payload_for_workspace(workspace.id)

    assert is_binary(message)
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

  test "session_payload_for_cell falls back to workspace model defaults" do
    workspace = workspace!("agents-domain-workspace-model")

    File.write!(
      Path.join(workspace.path, "opencode.json"),
      Jason.encode!(%{"model" => "opencode/big-pickle"})
    )

    cell = cell!(workspace, "ready")

    assert {:ok, _event} =
             AgentEventLog.append(%{
               workspace_id: workspace.id,
               cell_id: cell.id,
               session_id: "session-workspace-model-1",
               seq: 1,
               event_type: "session.idle",
               payload: %{"payload" => %{"type" => "session.idle"}}
             })

    assert {:ok, payload} = Agents.session_payload_for_cell(cell.id)
    assert payload.modelId == "big-pickle"
    assert payload.modelProviderId == "opencode"
  end

  test "messages_payload_for_session returns normalized messages through the real client transport",
       %{
         opencode_server: server
       } do
    workspace = workspace!("agents-domain-messages")
    cell = cell!(workspace, "ready")
    session = real_agent_session!(server, workspace, cell)

    assert {:ok, %{messages: [user_message, assistant_message]}} =
             Agents.messages_payload_for_session(session.session_id)

    assert user_message.role == "user"
    assert is_binary(user_message.content)
    assert user_message.content != ""
    assert assistant_message.role == "assistant"
    assert is_binary(assistant_message.content)
    assert assistant_message.content != ""
  end

  test "messages_payload_for_session returns an empty list when session fetch returns not found",
       %{} do
    workspace = workspace!("agents-domain-messages-fallback")
    cell = cell!(workspace, "ready")
    session = agent_session!(cell, "missing-session-#{System.unique_integer([:positive])}")

    assert {:ok, %{messages: []}} =
             Agents.messages_payload_for_session(session.session_id)
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

  defp agent_session!(cell, session_id \\ "session-#{System.unique_integer([:positive])}") do
    assert {:ok, session} =
             Ash.create(
               AgentSession,
               %{
                 cell_id: cell.id,
                 session_id: session_id,
                 model_id: "big-pickle",
                 model_provider_id: "opencode",
                 start_mode: "plan",
                 current_mode: "build"
               },
               domain: Cells
             )

    session
  end

  defp real_agent_session!(server, workspace, cell) do
    session =
      OpencodeRealServer.create_session!(
        server,
        workspace.path,
        "agents-test-#{System.unique_integer([:positive])}"
      )

    _response =
      OpencodeRealServer.prompt!(
        server,
        workspace.path,
        session["id"],
        "Reply with two short words."
      )

    agent_session!(cell, session["id"])
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
      _ = File.rm_rf(path)
    end)

    path
  end

  defp restore_env(key, nil), do: Application.delete_env(:hive_server_elixir, key)
  defp restore_env(key, value), do: Application.put_env(:hive_server_elixir, key, value)
end

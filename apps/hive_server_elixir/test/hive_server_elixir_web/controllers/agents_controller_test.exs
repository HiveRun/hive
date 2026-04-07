defmodule HiveServerElixirWeb.AgentsControllerTest do
  use HiveServerElixirWeb.ConnCase

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.AgentSession
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Workspace
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

    on_exit(fn ->
      :ok = Workspaces.set_active_workspace_id(previous_active_workspace_id)
      restore_env(:opencode_base_url, previous_base_url)
      restore_env(:opencode_client_opts, previous_client_opts)
    end)

    {:ok, opencode_server: server}
  end

  test "GET /api/agents/models returns providers, models, and defaults", %{conn: conn} do
    workspace = workspace!("models")

    conn = get(conn, ~p"/api/agents/models?workspaceId=#{workspace.id}")

    assert %{
             "models" => models,
             "defaults" => defaults,
             "providers" => providers
           } = json_response(conn, 200)

    assert Enum.any?(models, fn model ->
             model["id"] == "big-pickle" and
               model["name"] == "Big Pickle" and
               model["provider"] == "opencode"
           end)

    assert defaults["opencode"] == "big-pickle"

    assert Enum.any?(providers, &(&1["id"] == "opencode"))
  end

  test "GET /api/agents/models returns 400 payload when provider catalog fails", %{conn: conn} do
    previous_base_url = Application.get_env(:hive_server_elixir, :opencode_base_url)
    workspace = workspace!("models-error")

    Application.put_env(:hive_server_elixir, :opencode_base_url, "http://127.0.0.1:1")

    on_exit(fn ->
      restore_env(:opencode_base_url, previous_base_url)
    end)

    conn = get(conn, ~p"/api/agents/models?workspaceId=#{workspace.id}")

    assert %{"models" => [], "defaults" => %{}, "providers" => [], "message" => message} =
             json_response(conn, 400)

    assert is_binary(message)
  end

  test "GET /api/agents/sessions/:id/models resolves workspace from session", %{conn: conn} do
    workspace = workspace!("session-models")
    cell = cell!(workspace)
    agent_session = agent_session!(cell)

    conn = get(conn, ~p"/api/agents/sessions/#{agent_session.session_id}/models")

    assert %{"models" => models, "defaults" => defaults, "providers" => providers} =
             json_response(conn, 200)

    assert Enum.any?(models, &(&1["id"] == "big-pickle"))
    assert defaults["opencode"] == "big-pickle"
    assert Enum.any?(providers, &(&1["id"] == "opencode"))
  end

  test "GET /api/agents/sessions/:id/messages returns normalized session messages", %{
    conn: conn,
    opencode_server: server
  } do
    workspace = workspace!("session-messages")
    cell = cell!(workspace)
    agent_session = real_agent_session!(server, workspace, cell)

    conn = get(conn, ~p"/api/agents/sessions/#{agent_session.session_id}/messages")

    assert %{"messages" => [user_message, assistant_message]} = json_response(conn, 200)

    assert user_message["role"] == "user"
    assert user_message["state"] == "completed"
    assert is_binary(user_message["content"])
    assert user_message["content"] != ""

    assert assistant_message["role"] == "assistant"
    assert assistant_message["state"] == "completed"
    assert is_binary(assistant_message["content"])
    assert assistant_message["content"] != ""
  end

  test "GET /api/agents/sessions/:id/events emits initial status and mode snapshots", %{
    conn: conn
  } do
    workspace = workspace!("session-events")
    cell = cell!(workspace)
    agent_session = agent_session!(cell)

    conn = get(conn, ~p"/api/agents/sessions/#{agent_session.session_id}/events?initialOnly=true")

    assert conn.status == 200
    assert conn.resp_body =~ "event: status"
    assert conn.resp_body =~ "awaiting_input"
    assert conn.resp_body =~ "event: mode"
    assert conn.resp_body =~ "\"startMode\":\"plan\""
    assert conn.resp_body =~ "\"currentMode\":\"build\""
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

  defp cell!(workspace) do
    assert {:ok, cell} =
             Ash.create(
               Cell,
               %{
                 workspace_id: workspace.id,
                 name: "Agent Cell",
                 template_id: "basic",
                 workspace_root_path: workspace.path,
                 workspace_path: workspace.path,
                 status: "ready"
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

  defp real_agent_session!(server, workspace, cell) do
    session =
      OpencodeRealServer.create_session!(
        server,
        workspace.path,
        "controller-session-#{System.unique_integer([:positive])}"
      )

    _response =
      OpencodeRealServer.prompt!(
        server,
        workspace.path,
        session["id"],
        "Reply with two short words."
      )

    assert {:ok, agent_session} =
             Ash.create(
               AgentSession,
               %{
                 cell_id: cell.id,
                 session_id: session["id"],
                 model_id: "big-pickle",
                 model_provider_id: "opencode",
                 start_mode: "plan",
                 current_mode: "build"
               },
               domain: Cells
             )

    agent_session
  end

  defp tmp_workspace_path!(suffix) do
    path =
      Path.join(
        System.tmp_dir!(),
        "hive-agents-#{suffix}-#{System.unique_integer([:positive])}"
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

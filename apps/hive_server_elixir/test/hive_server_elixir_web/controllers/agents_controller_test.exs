defmodule HiveServerElixirWeb.AgentsControllerTest do
  use HiveServerElixirWeb.ConnCase

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.AgentSession
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Workspace
  alias HiveServerElixir.Opencode.TestClient
  alias HiveServerElixir.Workspaces

  setup do
    previous_active_workspace_id = Workspaces.active_workspace_id()
    previous_client = Application.get_env(:hive_server_elixir, :opencode_client)
    previous_client_opts = Application.get_env(:hive_server_elixir, :opencode_client_opts)

    Application.put_env(:hive_server_elixir, :opencode_client, TestClient)
    Application.delete_env(:hive_server_elixir, :opencode_client_opts)

    on_exit(fn ->
      :ok = Workspaces.set_active_workspace_id(previous_active_workspace_id)

      restore_env(:opencode_client, previous_client)
      restore_env(:opencode_client_opts, previous_client_opts)
    end)

    :ok
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

    assert defaults == %{"opencode" => "big-pickle"}

    assert Enum.any?(providers, fn provider ->
             provider["id"] == "opencode" and provider["name"] == "OpenCode"
           end)
  end

  test "GET /api/agents/models returns 400 payload when provider catalog fails", %{conn: conn} do
    workspace = workspace!("models-error")

    callback = fn _operation ->
      {:error, %{status: 400, body: %{"message" => "Catalog unavailable"}}}
    end

    Application.put_env(
      :hive_server_elixir,
      :opencode_client_opts,
      test_client_callback: callback
    )

    conn = get(conn, ~p"/api/agents/models?workspaceId=#{workspace.id}")

    assert %{"models" => [], "defaults" => %{}, "providers" => [], "message" => message} =
             json_response(conn, 400)

    assert message == "Catalog unavailable"
  end

  test "GET /api/agents/sessions/:id/models resolves workspace from session", %{conn: conn} do
    workspace = workspace!("session-models")
    cell = cell!(workspace)
    agent_session = agent_session!(cell)

    conn = get(conn, ~p"/api/agents/sessions/#{agent_session.session_id}/models")

    assert %{"models" => models, "defaults" => defaults, "providers" => providers} =
             json_response(conn, 200)

    assert Enum.any?(models, &(&1["id"] == "big-pickle"))
    assert defaults == %{"opencode" => "big-pickle"}
    assert Enum.any?(providers, &(&1["id"] == "opencode"))
  end

  test "GET /api/agents/sessions/byCell/:cellId returns serialized session payload", %{conn: conn} do
    workspace = workspace!("session-by-cell")
    cell = cell!(workspace)
    agent_session = agent_session!(cell)

    conn = get(conn, ~p"/api/agents/sessions/byCell/#{cell.id}")

    assert %{"session" => session} = json_response(conn, 200)

    assert session["id"] == agent_session.session_id
    assert session["cellId"] == cell.id
    assert session["templateId"] == cell.template_id
    assert session["provider"] == "opencode"
    assert session["status"] == "awaiting_input"
    assert session["workspacePath"] == cell.workspace_path
    assert session["modelId"] == "big-pickle"
    assert session["modelProviderId"] == "opencode"
    assert session["startMode"] == "plan"
    assert session["currentMode"] == "build"
    assert is_binary(session["createdAt"])
    assert is_binary(session["updatedAt"])
    assert is_binary(session["modeUpdatedAt"])
  end

  test "GET /api/agents/sessions/:id/messages returns normalized session messages", %{conn: conn} do
    workspace = workspace!("session-messages")
    cell = cell!(workspace)
    agent_session = agent_session!(cell)

    conn = get(conn, ~p"/api/agents/sessions/#{agent_session.session_id}/messages")

    assert %{"messages" => [user_message, assistant_message]} = json_response(conn, 200)

    assert user_message["id"] == "message-user-1"
    assert user_message["role"] == "user"
    assert user_message["state"] == "completed"
    assert user_message["content"] == "Summarize project status"

    assert assistant_message["id"] == "message-assistant-1"
    assert assistant_message["role"] == "assistant"
    assert assistant_message["state"] == "completed"
    assert assistant_message["content"] == "Status is green."
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

  test "GET /api/agents/sessions/byCell/:cellId returns null when no agent session exists", %{
    conn: conn
  } do
    workspace = workspace!("session-by-cell-empty")
    cell = cell!(workspace)

    conn = get(conn, ~p"/api/agents/sessions/byCell/#{cell.id}")

    assert %{"session" => nil} = json_response(conn, 200)
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

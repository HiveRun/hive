defmodule HiveServerElixir.AgentsTest do
  use HiveServerElixir.DataCase

  alias HiveServerElixir.Agents
  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.AgentSession
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.TerminalRuntime
  alias HiveServerElixir.Cells.Workspace
  alias HiveServerElixir.Opencode.AgentEventLog
  alias HiveServerElixir.OpencodeFakeServer
  alias HiveServerElixir.Workspaces

  setup do
    previous_active_workspace_id = Workspaces.active_workspace_id()
    previous_client_opts = Application.get_env(:hive_server_elixir, :opencode_client_opts)
    opencode = OpencodeFakeServer.setup_open_code_stub()

    Application.put_env(:hive_server_elixir, :opencode_client_opts, opencode.client_opts)
    :ok = Workspaces.set_active_workspace_id(nil)

    on_exit(fn ->
      :ok = Workspaces.set_active_workspace_id(previous_active_workspace_id)

      restore_env(:opencode_client_opts, previous_client_opts)
    end)

    {:ok, opencode: opencode}
  end

  test "provider_payload_for_workspace returns normalized catalog payload", %{opencode: opencode} do
    workspace = workspace!("agents-domain-models")

    assert {:ok, payload} = Agents.provider_payload_for_workspace(workspace.id)
    assert payload.defaults == %{"opencode" => "big-pickle"}
    assert Enum.any?(payload.providers, &(&1.id == "opencode"))
    assert Enum.any?(payload.models, &(&1.id == "big-pickle" and &1.provider == "opencode"))

    assert [%{method: "GET", path: "/config/providers", params: %{"directory" => directory}}] =
             OpencodeFakeServer.requests(opencode)

    assert directory == workspace.path
  end

  test "provider_payload_for_session resolves workspace path through the real client transport",
       %{
         opencode: opencode
       } do
    workspace = workspace!("agents-domain-session-models")
    cell = cell!(workspace, "ready")
    session = agent_session!(cell)

    assert {:ok, payload} = Agents.provider_payload_for_session(session.session_id)
    assert payload.defaults == %{"opencode" => "big-pickle"}

    assert [%{method: "GET", path: "/config/providers", params: %{"directory" => directory}}] =
             OpencodeFakeServer.requests(opencode)

    assert directory == workspace.path
  end

  test "provider_payload_for_workspace surfaces transport-backed errors", %{opencode: opencode} do
    workspace = workspace!("agents-domain-models-error")

    :ok =
      OpencodeFakeServer.put_catalog(
        opencode,
        {:error, %{status: 400, body: %{message: "Catalog unavailable"}}}
      )

    assert {:error, {:bad_request, "Catalog unavailable"}} =
             Agents.provider_payload_for_workspace(workspace.id)
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
         opencode: opencode
       } do
    workspace = workspace!("agents-domain-messages")
    cell = cell!(workspace, "ready")
    session = agent_session!(cell)

    :ok =
      OpencodeFakeServer.put_session_messages(opencode, session.session_id, {
        :ok,
        [
          %{
            "info" => %{
              "id" => "message-user-1",
              "role" => "user",
              "sessionID" => session.session_id,
              "time" => %{"created" => 1_704_067_200_000}
            },
            "parts" => [
              %{"id" => "part-user-1", "type" => "text", "text" => "Summarize project status"}
            ]
          },
          %{
            "info" => %{
              "id" => "message-assistant-1",
              "role" => "assistant",
              "sessionID" => session.session_id,
              "finish" => "stop",
              "time" => %{"created" => 1_704_067_201_000, "completed" => 1_704_067_202_000}
            },
            "parts" => [
              %{"id" => "part-assistant-1", "type" => "text", "text" => "Status is green."}
            ]
          }
        ]
      })

    assert {:ok, %{messages: [user_message, assistant_message]}} =
             Agents.messages_payload_for_session(session.session_id)

    assert user_message.role == "user"
    assert user_message.content == "Summarize project status"
    assert assistant_message.role == "assistant"
    assert assistant_message.content == "Status is green."

    assert [%{method: "GET", path: path, params: %{"directory" => directory}}] =
             OpencodeFakeServer.requests(opencode)

    assert path == "/session/#{session.session_id}/message"
    assert directory == workspace.path
  end

  test "messages_payload_for_session falls back to terminal output when session fetch returns not found",
       %{opencode: opencode} do
    workspace = workspace!("agents-domain-messages-fallback")
    cell = cell!(workspace, "ready")
    session = agent_session!(cell)

    :ok =
      OpencodeFakeServer.put_session_messages(opencode, session.session_id, {
        :error,
        %{status: 404, body: %{message: "missing session"}}
      })

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

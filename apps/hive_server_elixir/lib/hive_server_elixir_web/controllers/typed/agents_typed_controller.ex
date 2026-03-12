defmodule HiveServerElixir.AgentsTypedController do
  use AshTypescript.TypedController

  alias HiveServerElixir.Agents
  alias HiveServerElixirWeb.TypedControllerSupport

  typed_controller do
    module_name(HiveServerElixirWeb.AgentReadController)

    route :agent_models do
      method(:get)
      argument(:workspace_id, :string)

      run(fn conn, params ->
        workspace_id = TypedControllerSupport.workspace_id_from_params_or_header(params, conn)

        case Agents.provider_payload_for_workspace(workspace_id) do
          {:ok, payload} ->
            Phoenix.Controller.json(conn, payload)

          {:error, {status, message}} ->
            conn
            |> Plug.Conn.put_status(status)
            |> Phoenix.Controller.json(Agents.empty_provider_payload(message))
        end
      end)
    end

    route :agent_session_models do
      method(:get)
      argument(:id, :string, allow_nil?: false)

      run(fn conn, %{id: session_id} ->
        case Agents.provider_payload_for_session(session_id) do
          {:ok, payload} ->
            Phoenix.Controller.json(conn, payload)

          {:error, {status, message}} ->
            conn
            |> Plug.Conn.put_status(status)
            |> Phoenix.Controller.json(Agents.empty_provider_payload(message))
        end
      end)
    end

    route :agent_session_messages do
      method(:get)
      argument(:id, :string, allow_nil?: false)

      run(fn conn, %{id: session_id} ->
        case Agents.messages_payload_for_session(session_id) do
          {:ok, payload} ->
            Phoenix.Controller.json(conn, payload)

          {:error, {status, message}} ->
            TypedControllerSupport.json_message(conn, status, message)
        end
      end)
    end
  end
end

defmodule HiveServerElixir.AgentsTypedController do
  use AshTypescript.TypedController

  alias HiveServerElixir.Agents

  typed_controller do
    module_name(HiveServerElixirWeb.AgentReadController)

    route :agent_models do
      method(:get)
      argument(:workspace_id, :string)

      run(fn conn, params ->
        workspace_id = resolve_workspace_id(params, conn)

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
            conn
            |> Plug.Conn.put_status(status)
            |> Phoenix.Controller.json(%{message: message})
        end
      end)
    end
  end

  defp resolve_workspace_id(params, conn) do
    query_workspace_id = params[:workspace_id]

    if is_binary(query_workspace_id) and byte_size(String.trim(query_workspace_id)) > 0 do
      String.trim(query_workspace_id)
    else
      case Plug.Conn.get_req_header(conn, "x-workspace-id") do
        [workspace_id | _rest] ->
          trimmed_workspace_id = String.trim(workspace_id)
          if byte_size(trimmed_workspace_id) > 0, do: trimmed_workspace_id, else: nil

        _other ->
          nil
      end
    end
  end
end

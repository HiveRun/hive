defmodule HiveServerElixirWeb.TypedControllerSupport do
  @moduledoc false

  @spec workspace_id_from_params_or_header(map(), Plug.Conn.t()) :: String.t() | nil
  def workspace_id_from_params_or_header(params, conn) when is_map(params) do
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

  @spec json_message(Plug.Conn.t(), Plug.Conn.status(), String.t()) :: Plug.Conn.t()
  def json_message(conn, status, message) when is_binary(message) do
    conn
    |> Plug.Conn.put_status(status)
    |> Phoenix.Controller.json(%{message: message})
  end
end

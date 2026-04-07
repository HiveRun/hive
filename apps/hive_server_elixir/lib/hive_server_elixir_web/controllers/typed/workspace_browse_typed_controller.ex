defmodule HiveServerElixir.WorkspaceBrowseTypedController do
  use AshTypescript.TypedController

  alias HiveServerElixir.Workspaces.Browse

  typed_controller do
    module_name(HiveServerElixirWeb.WorkspaceBrowseController)

    route :workspace_browse do
      method(:get)
      argument(:path, :string)
      argument(:filter, :string)

      run(fn conn, params ->
        case Browse.list_directories(params[:path], params[:filter]) do
          {:ok, payload} ->
            Phoenix.Controller.json(conn, payload)

          {:error, message} ->
            conn
            |> Plug.Conn.put_status(:bad_request)
            |> Phoenix.Controller.json(%{message: message})
        end
      end)
    end
  end
end

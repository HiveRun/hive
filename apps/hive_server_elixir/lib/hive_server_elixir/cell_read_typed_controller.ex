defmodule HiveServerElixir.CellReadTypedController do
  use AshTypescript.TypedController

  alias Ash.Error.Invalid.InvalidPrimaryKey
  alias Ash.Error.Query.NotFound
  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Diff
  alias HiveServerElixir.Cells.ResourceSnapshotPayload

  typed_controller do
    module_name(HiveServerElixirWeb.CellReadController)

    route :cell_diff do
      method(:get)
      argument(:id, :string, allow_nil?: false)
      argument(:mode, :string)
      argument(:summary, :string)
      argument(:files, :string)

      run(fn conn, %{id: id} = params ->
        case Ash.get(Cell, id, domain: Cells) do
          {:ok, cell} ->
            case Diff.build_payload(cell, diff_params(params)) do
              {:ok, payload} ->
                Phoenix.Controller.json(conn, payload)

              {:error, {status, message}} ->
                conn
                |> Plug.Conn.put_status(status)
                |> Phoenix.Controller.json(%{message: message})
            end

          {:error, error} ->
            render_cell_error(conn, error)
        end
      end)
    end

    route :cell_resources do
      method(:get)
      argument(:id, :string, allow_nil?: false)
      argument(:include_history, :boolean)
      argument(:include_averages, :boolean)
      argument(:include_rollups, :boolean)
      argument(:history_limit, :integer)
      argument(:rollup_limit, :integer)

      run(fn conn, %{id: id} = params ->
        case Ash.get(Cell, id, domain: Cells) do
          {:ok, %Cell{} = cell} ->
            Phoenix.Controller.json(conn, ResourceSnapshotPayload.build(cell, params))

          {:error, error} ->
            render_cell_error(conn, error)
        end
      end)
    end
  end

  defp diff_params(params) do
    %{
      "mode" => params[:mode],
      "summary" => params[:summary],
      "files" => params[:files]
    }
  end

  defp render_cell_error(conn, error) do
    {status, code} = classify_error(error)

    conn
    |> Plug.Conn.put_status(status)
    |> Phoenix.Controller.json(%{error: %{code: code, message: Exception.message(error)}})
  end

  defp classify_error(error) do
    cond do
      contains_error?(error, InvalidPrimaryKey) -> {:bad_request, "invalid_cell_id"}
      contains_error?(error, NotFound) -> {:not_found, "not_found"}
      true -> {:unprocessable_entity, "lifecycle_failed"}
    end
  end

  defp contains_error?(error, module) when is_atom(module) do
    case error do
      %{__struct__: ^module} ->
        true

      %{errors: errors} when is_list(errors) ->
        Enum.any?(errors, &contains_error?(&1, module))

      %{error: nested} ->
        contains_error?(nested, module)

      _ ->
        false
    end
  end
end

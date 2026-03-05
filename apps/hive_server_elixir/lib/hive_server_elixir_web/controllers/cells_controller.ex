defmodule HiveServerElixirWeb.CellsController do
  use HiveServerElixirWeb, :controller

  alias Ash.Error.Invalid.InvalidPrimaryKey
  alias Ash.Error.Query.NotFound
  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Cell

  def create(conn, params) do
    workspace_id = read_param(params, "workspaceId", "workspace_id")
    description = read_param(params, "description")

    with :ok <- validate_workspace_id(workspace_id),
         :ok <- validate_description(description),
         {:ok, cell} <-
           Cells.create_cell(%{
             workspace_id: workspace_id,
             description: description,
             runtime_opts: runtime_opts(),
             fail_after_ingest: false
           }) do
      conn
      |> put_status(:created)
      |> json(%{cell: serialize_cell(cell)})
    else
      {:error, :invalid_workspace_id} ->
        bad_request(conn, "workspaceId is required")

      {:error, :invalid_description} ->
        bad_request(conn, "description must be a string when provided")

      {:error, error} ->
        render_cell_error(conn, error)
    end
  end

  def retry(conn, %{"id" => id}) do
    case Cells.retry_cell(%{cell_id: id, runtime_opts: runtime_opts(), fail_after_ingest: false}) do
      {:ok, cell} -> json(conn, %{cell: serialize_cell(cell)})
      {:error, error} -> render_cell_error(conn, error)
    end
  end

  def resume(conn, %{"id" => id}) do
    case Cells.resume_cell(%{cell_id: id, runtime_opts: runtime_opts(), fail_after_ingest: false}) do
      {:ok, cell} -> json(conn, %{cell: serialize_cell(cell)})
      {:error, error} -> render_cell_error(conn, error)
    end
  end

  def delete(conn, %{"id" => id}) do
    case Cells.delete_cell(%{cell_id: id, runtime_opts: runtime_opts(), fail_after_stop: false}) do
      {:ok, %Cell{} = cell} -> json(conn, %{cell: serialize_cell(cell)})
      {:error, error} -> render_cell_error(conn, error)
    end
  end

  defp runtime_opts do
    Application.get_env(:hive_server_elixir, :cell_reactor_runtime_opts, [])
  end

  defp validate_workspace_id(workspace_id)
       when is_binary(workspace_id) and byte_size(workspace_id) > 0,
       do: :ok

  defp validate_workspace_id(_), do: {:error, :invalid_workspace_id}

  defp validate_description(nil), do: :ok
  defp validate_description(description) when is_binary(description), do: :ok
  defp validate_description(_), do: {:error, :invalid_description}

  defp serialize_cell(%Cell{} = cell) do
    %{
      id: cell.id,
      workspaceId: cell.workspace_id,
      description: cell.description,
      status: cell.status,
      insertedAt: maybe_to_iso8601(cell.inserted_at),
      updatedAt: maybe_to_iso8601(cell.updated_at)
    }
  end

  defp maybe_to_iso8601(nil), do: nil
  defp maybe_to_iso8601(datetime), do: DateTime.to_iso8601(datetime)

  defp read_param(params, key, fallback_key \\ nil) do
    Map.get(params, key) || if(fallback_key, do: Map.get(params, fallback_key), else: nil)
  end

  defp bad_request(conn, message) do
    conn
    |> put_status(:bad_request)
    |> json(%{error: %{code: "bad_request", message: message}})
  end

  defp render_cell_error(conn, error) do
    {status, code} = classify_error(error)

    conn
    |> put_status(status)
    |> json(%{error: %{code: code, message: Exception.message(error)}})
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

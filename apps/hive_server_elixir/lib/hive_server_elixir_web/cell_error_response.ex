defmodule HiveServerElixirWeb.CellErrorResponse do
  @moduledoc false

  alias Ash.Error.Invalid.InvalidPrimaryKey
  alias Ash.Error.Query.NotFound

  @spec render(Plug.Conn.t(), term()) :: Plug.Conn.t()
  def render(conn, error) do
    {status, code} = classify(error)

    conn
    |> Plug.Conn.put_status(status)
    |> Phoenix.Controller.json(%{error: %{code: code, message: Exception.message(error)}})
  end

  @spec classify(term()) :: {Plug.Conn.status(), String.t()}
  def classify(error) do
    cond do
      contains_error?(error, InvalidPrimaryKey) -> {:bad_request, "invalid_cell_id"}
      contains_error?(error, NotFound) -> {:not_found, "not_found"}
      true -> {:unprocessable_entity, "lifecycle_failed"}
    end
  end

  defp contains_error?(error, module) when is_atom(module) do
    case error do
      %{__struct__: ^module} -> true
      %{errors: errors} when is_list(errors) -> Enum.any?(errors, &contains_error?(&1, module))
      %{error: nested} -> contains_error?(nested, module)
      _ -> false
    end
  end
end

defmodule HiveServerElixir.Cells.SetupAttempt do
  @moduledoc false

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Cell

  @spec finalize_error(Cell.t() | String.t(), term()) :: :ok | {:error, term()}
  def finalize_error(%Cell{id: cell_id}, reason), do: finalize_error(cell_id, reason)

  def finalize_error(cell_id, reason) when is_binary(cell_id) do
    with {:ok, cell} <- Ash.get(Cell, cell_id, domain: Cells) do
      finalize_error(cell, reason, cell_id)
    end
  end

  defp finalize_error(%Cell{status: status}, _reason, _cell_id)
       when status not in [:provisioning, "provisioning"] do
    :ok
  end

  defp finalize_error(%Cell{} = cell, reason, _cell_id) do
    cell
    |> Ash.Changeset.for_update(
      :finalize_setup_attempt,
      %{last_setup_error: format_reason(reason), result: "error"}
    )
    |> Ash.update(domain: Cells)
    |> case do
      {:ok, _updated_cell} -> :ok
      {:error, error} -> {:error, error}
    end
  end

  defp format_reason(reason) when is_binary(reason), do: reason
  defp format_reason(reason) when is_atom(reason), do: Atom.to_string(reason)
  defp format_reason(reason), do: inspect(reason)
end

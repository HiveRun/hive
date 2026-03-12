defmodule HiveServerElixir.Cells.CellCommands do
  @moduledoc false

  alias HiveServerElixir.Cells.Reactors.CreateCell
  alias HiveServerElixir.Cells.Reactors.DeleteCell
  alias HiveServerElixir.Cells.Reactors.ResumeCell
  alias HiveServerElixir.Cells.Reactors.RetryCell

  @spec create(map()) :: {:ok, HiveServerElixir.Cells.Cell.t()} | {:error, term()}
  def create(input) when is_map(input) do
    prepared_input =
      input
      |> Map.put_new(:name, "Cell")
      |> Map.put_new(:template_id, "default-template")
      |> Map.put_new(:start_mode, "plan")
      |> Map.put_new(:workspace_root_path, ".")
      |> Map.put_new(:workspace_path, ".")

    Reactor.run(CreateCell, prepared_input)
  end

  @spec retry(map()) :: {:ok, HiveServerElixir.Cells.Cell.t()} | {:error, term()}
  def retry(input) when is_map(input), do: Reactor.run(RetryCell, input)

  @spec resume(map()) :: {:ok, HiveServerElixir.Cells.Cell.t()} | {:error, term()}
  def resume(input) when is_map(input), do: Reactor.run(ResumeCell, input)

  @spec delete(map()) :: {:ok, HiveServerElixir.Cells.Cell.t()} | {:error, term()}
  def delete(input) when is_map(input), do: Reactor.run(DeleteCell, input)
end

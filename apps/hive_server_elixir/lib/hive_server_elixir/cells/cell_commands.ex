defmodule HiveServerElixir.Cells.CellCommands do
  @moduledoc false

  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Reactors.CreateCell
  alias HiveServerElixir.Cells.Reactors.DeleteCell
  alias HiveServerElixir.Cells.Reactors.ResumeCell
  alias HiveServerElixir.Cells.Reactors.RetryCell

  @spec create(map()) :: {:ok, HiveServerElixir.Cells.Cell.t()} | {:error, term()}
  def create(input) when is_map(input) do
    prepared_input = prepare_create_input(input)

    with {:ok, cell} <- Reactor.run(CreateCell, prepared_input),
         :ok <-
           Cell.enqueue_provisioning(:create, cell,
             runtime_opts: Map.get(prepared_input, :runtime_opts, []),
             fail_after_ingest: Map.get(prepared_input, :fail_after_ingest, false)
           ) do
      {:ok, cell}
    end
  end

  @spec retry(map()) :: {:ok, HiveServerElixir.Cells.Cell.t()} | {:error, term()}
  def retry(input) when is_map(input) do
    prepared_input = Map.put_new(input, :runtime_opts, [])

    with {:ok, cell} <- Reactor.run(RetryCell, prepared_input),
         :ok <-
           Cell.enqueue_provisioning(:retry, cell,
             runtime_opts: Map.get(prepared_input, :runtime_opts, []),
             fail_after_ingest: Map.get(prepared_input, :fail_after_ingest, false)
           ) do
      {:ok, cell}
    end
  end

  @spec resume(map()) :: {:ok, HiveServerElixir.Cells.Cell.t()} | {:error, term()}
  def resume(input) when is_map(input) do
    prepared_input = Map.put_new(input, :runtime_opts, [])

    with {:ok, cell} <- Reactor.run(ResumeCell, prepared_input),
         :ok <-
           Cell.enqueue_provisioning(:resume, cell,
             runtime_opts: Map.get(prepared_input, :runtime_opts, []),
             fail_after_ingest: Map.get(prepared_input, :fail_after_ingest, false)
           ) do
      {:ok, cell}
    end
  end

  @spec delete(map()) :: {:ok, HiveServerElixir.Cells.Cell.t()} | {:error, term()}
  def delete(input) when is_map(input), do: Reactor.run(DeleteCell, input)

  defp prepare_create_input(input) do
    input
    |> Map.put_new(:name, "Cell")
    |> Map.put_new(:template_id, "default-template")
    |> Map.put_new(:provider_id, nil)
    |> Map.put_new(:model_id, nil)
    |> Map.put_new(:start_mode, "plan")
    |> Map.put_new(:workspace_root_path, ".")
    |> Map.put_new(:workspace_path, ".")
    |> Map.put_new(:runtime_opts, [])
  end
end

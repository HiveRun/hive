defmodule HiveServerElixir.Cells.ProvisioningRuntime do
  @moduledoc false

  import Ash.Expr
  require Ash.Query

  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.ProvisioningWorker

  @registry HiveServerElixir.Cells.ProvisioningRegistry
  @supervisor HiveServerElixir.Cells.ProvisioningSupervisor

  @type mode :: :create | :retry | :resume

  @spec start(mode(), String.t(), keyword()) :: DynamicSupervisor.on_start_child()
  def start(mode, cell_id, opts \\ [])
      when mode in [:create, :retry, :resume] and is_binary(cell_id) do
    worker_opts = [
      name: via_tuple(cell_id),
      cell_id: cell_id,
      mode: mode,
      runtime_opts: Keyword.get(opts, :runtime_opts, []),
      fail_after_ingest: Keyword.get(opts, :fail_after_ingest, false)
    ]

    DynamicSupervisor.start_child(@supervisor, {ProvisioningWorker, worker_opts})
  end

  @spec restart(mode(), String.t(), keyword()) :: DynamicSupervisor.on_start_child()
  def restart(mode, cell_id, opts \\ []) when mode in [:create, :retry, :resume] do
    _ = stop(cell_id)
    start(mode, cell_id, opts)
  end

  @spec stop(String.t()) :: :ok | {:error, :not_found}
  def stop(cell_id) when is_binary(cell_id) do
    case Registry.lookup(@registry, cell_id) do
      [{pid, _value}] -> DynamicSupervisor.terminate_child(@supervisor, pid)
      [] -> {:error, :not_found}
    end
  end

  @spec resume_incomplete_cells(keyword()) :: :ok
  def resume_incomplete_cells(opts \\ []) do
    Cell
    |> Ash.Query.filter(expr(status == :provisioning))
    |> Ash.read!()
    |> Enum.each(fn cell ->
      _ = start(:retry, cell.id, opts)
    end)

    :ok
  end

  defp via_tuple(cell_id) do
    {:via, Registry, {@registry, cell_id}}
  end
end

defmodule HiveServerElixir.Cells do
  @moduledoc """
  Ash domain for workspace and cell lifecycle records.
  """

  use Ash.Domain, extensions: [AshTypescript.Rpc]

  alias HiveServerElixir.Cells.Reactors.CreateCell
  alias HiveServerElixir.Cells.Reactors.DeleteCell
  alias HiveServerElixir.Cells.Reactors.ResumeCell
  alias HiveServerElixir.Cells.Reactors.RetryCell

  typescript_rpc do
    resource HiveServerElixir.Cells.Workspace do
      rpc_action :list_workspaces, :ui_list
    end

    resource HiveServerElixir.Cells.Cell do
      rpc_action :list_cells, :ui_list
      rpc_action :get_cell, :ui_get, get?: true, not_found_error?: false
    end

    resource HiveServerElixir.Cells.Activity do
      rpc_action :list_cell_activity, :for_cell
    end

    resource HiveServerElixir.Cells.Timing do
      rpc_action :list_cell_timings, :for_cell
      rpc_action :list_global_cell_timings, :global
    end
  end

  resources do
    resource HiveServerElixir.Cells.Workspace
    resource HiveServerElixir.Cells.Cell
    resource HiveServerElixir.Cells.Provisioning
    resource HiveServerElixir.Cells.Service
    resource HiveServerElixir.Cells.AgentSession
    resource HiveServerElixir.Cells.Activity
    resource HiveServerElixir.Cells.Timing
  end

  @spec create_cell(map) :: {:ok, HiveServerElixir.Cells.Cell.t()} | {:error, term()}
  def create_cell(input) when is_map(input) do
    prepared_input =
      input
      |> Map.put_new(:name, "Cell")
      |> Map.put_new(:template_id, "default-template")
      |> Map.put_new(:start_mode, "plan")
      |> Map.put_new(:workspace_root_path, ".")
      |> Map.put_new(:workspace_path, ".")

    Reactor.run(CreateCell, prepared_input)
  end

  @spec retry_cell(map) :: {:ok, HiveServerElixir.Cells.Cell.t()} | {:error, term()}
  def retry_cell(input) when is_map(input) do
    Reactor.run(RetryCell, input)
  end

  @spec resume_cell(map) :: {:ok, HiveServerElixir.Cells.Cell.t()} | {:error, term()}
  def resume_cell(input) when is_map(input) do
    Reactor.run(ResumeCell, input)
  end

  @spec delete_cell(map) :: {:ok, HiveServerElixir.Cells.Cell.t()} | {:error, term()}
  def delete_cell(input) when is_map(input) do
    Reactor.run(DeleteCell, input)
  end
end

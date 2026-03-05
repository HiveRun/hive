defmodule HiveServerElixir.Cells do
  @moduledoc """
  Ash domain for workspace and cell lifecycle records.
  """

  use Ash.Domain

  alias HiveServerElixir.Cells.Reactors.CreateCell
  alias HiveServerElixir.Cells.Reactors.DeleteCell
  alias HiveServerElixir.Cells.Reactors.ResumeCell
  alias HiveServerElixir.Cells.Reactors.RetryCell

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
    Reactor.run(CreateCell, input)
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

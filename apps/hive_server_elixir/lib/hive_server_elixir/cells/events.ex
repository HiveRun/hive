defmodule HiveServerElixir.Cells.Events do
  @moduledoc false

  @pubsub HiveServerElixir.PubSub

  @spec publish_cell_status(String.t(), String.t()) :: :ok
  def publish_cell_status(workspace_id, cell_id)
      when is_binary(workspace_id) and is_binary(cell_id) do
    Phoenix.PubSub.broadcast(
      @pubsub,
      workspace_topic(workspace_id),
      {:cell_status, %{workspace_id: workspace_id, cell_id: cell_id}}
    )
  end

  @spec publish_cell_removed(String.t(), String.t()) :: :ok
  def publish_cell_removed(workspace_id, cell_id)
      when is_binary(workspace_id) and is_binary(cell_id) do
    Phoenix.PubSub.broadcast(
      @pubsub,
      workspace_topic(workspace_id),
      {:cell_removed, %{workspace_id: workspace_id, cell_id: cell_id}}
    )
  end

  @spec subscribe_workspace(String.t()) :: :ok | {:error, term()}
  def subscribe_workspace(workspace_id) when is_binary(workspace_id) do
    Phoenix.PubSub.subscribe(@pubsub, workspace_topic(workspace_id))
  end

  @spec publish_cell_timing(String.t(), String.t()) :: :ok
  def publish_cell_timing(cell_id, timing_id) when is_binary(cell_id) and is_binary(timing_id) do
    Phoenix.PubSub.broadcast(
      @pubsub,
      timing_topic(cell_id),
      {:cell_timing, %{cell_id: cell_id, timing_id: timing_id}}
    )
  end

  @spec subscribe_cell_timing(String.t()) :: :ok | {:error, term()}
  def subscribe_cell_timing(cell_id) when is_binary(cell_id) do
    Phoenix.PubSub.subscribe(@pubsub, timing_topic(cell_id))
  end

  @spec workspace_topic(String.t()) :: String.t()
  def workspace_topic(workspace_id), do: "workspace:" <> workspace_id

  @spec timing_topic(String.t()) :: String.t()
  def timing_topic(cell_id), do: "timings:" <> cell_id
end

defmodule HiveServerElixirWeb.WorkspaceChannel do
  @moduledoc false

  use AshTypescript.TypedChannel
  use HiveServerElixirWeb, :channel

  typed_channel do
    topic("workspace:*")

    resource HiveServerElixir.Cells.Cell do
      publish("cell_snapshot")
      publish("cell_removed")
    end
  end

  @impl true
  def join("workspace:" <> _workspace_id, _payload, socket), do: {:ok, socket}
end

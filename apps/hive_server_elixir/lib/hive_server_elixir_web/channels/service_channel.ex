defmodule HiveServerElixirWeb.ServiceChannel do
  @moduledoc false

  use AshTypescript.TypedChannel
  use HiveServerElixirWeb, :channel

  typed_channel do
    topic("services:*")

    resource HiveServerElixir.Cells.Service do
      publish("service_snapshot")
    end
  end

  @impl true
  def join("services:" <> _cell_id, _payload, socket), do: {:ok, socket}
end

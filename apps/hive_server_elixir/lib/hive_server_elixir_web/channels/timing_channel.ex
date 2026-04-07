defmodule HiveServerElixirWeb.TimingChannel do
  @moduledoc false

  use AshTypescript.TypedChannel
  use HiveServerElixirWeb, :channel

  typed_channel do
    topic("timings:*")

    resource HiveServerElixir.Cells.Timing do
      publish("timing_snapshot")
    end
  end

  @impl true
  def join("timings:" <> _cell_id, _payload, socket), do: {:ok, socket}
end

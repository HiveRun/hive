defmodule HiveServerElixirWeb.AshTypescriptRpcChannel do
  @moduledoc false

  use Phoenix.Channel

  @impl true
  def join("ash_typescript_rpc:" <> _suffix, _payload, socket) do
    {:ok, socket}
  end

  @impl true
  def handle_in("run", params, socket) do
    result = AshTypescript.Rpc.run_action(:hive_server_elixir, socket, params)
    {:reply, {:ok, result}, socket}
  end

  @impl true
  def handle_in("validate", params, socket) do
    result = AshTypescript.Rpc.validate_action(:hive_server_elixir, socket, params)
    {:reply, {:ok, result}, socket}
  end

  @impl true
  def handle_in(event, payload, socket) do
    {:reply, {:error, %{reason: "Unknown event: #{event}", payload: payload}}, socket}
  end
end

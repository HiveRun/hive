defmodule HiveServerElixirWeb.TerminalSocket do
  @moduledoc false

  use Phoenix.Socket

  channel("setup_terminal:*", HiveServerElixirWeb.TerminalChannel)
  channel("service_terminal:*", HiveServerElixirWeb.TerminalChannel)
  channel("chat_terminal:*", HiveServerElixirWeb.TerminalChannel)

  @impl true
  def connect(_params, socket, _connect_info), do: {:ok, socket}

  @impl true
  def id(_socket), do: nil
end

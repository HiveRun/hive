defmodule HiveServerElixirWeb.ChannelCase do
  @moduledoc false

  use ExUnit.CaseTemplate

  using do
    quote do
      use HiveServerElixirWeb, :verified_routes

      @endpoint HiveServerElixirWeb.Endpoint

      import Phoenix.ChannelTest
      import HiveServerElixirWeb.ChannelCase
    end
  end

  setup tags do
    HiveServerElixir.DataCase.setup_sandbox(tags)
    :ok
  end
end

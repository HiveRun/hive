defmodule HiveServerElixir.Opencode do
  @moduledoc """
  Ash domain for OpenCode persistence and workflows.
  """

  use Ash.Domain

  resources do
    resource HiveServerElixir.Opencode.AgentEvent
  end
end

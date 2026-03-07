defmodule HiveServerElixir.Opencode.Generated.ConfigMode do
  @moduledoc """
  Provides struct and type for a ConfigMode
  """

  @type t :: %__MODULE__{
          build: HiveServerElixir.Opencode.Generated.AgentConfig.t() | nil,
          plan: HiveServerElixir.Opencode.Generated.AgentConfig.t() | nil
        }

  defstruct [:build, :plan]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      build: {HiveServerElixir.Opencode.Generated.AgentConfig, :t},
      plan: {HiveServerElixir.Opencode.Generated.AgentConfig, :t}
    ]
  end
end

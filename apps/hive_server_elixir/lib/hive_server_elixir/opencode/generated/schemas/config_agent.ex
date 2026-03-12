defmodule HiveServerElixir.Opencode.Generated.ConfigAgent do
  @moduledoc """
  Provides struct and type for a ConfigAgent
  """

  @type t :: %__MODULE__{
          build: HiveServerElixir.Opencode.Generated.AgentConfig.t() | nil,
          compaction: HiveServerElixir.Opencode.Generated.AgentConfig.t() | nil,
          explore: HiveServerElixir.Opencode.Generated.AgentConfig.t() | nil,
          general: HiveServerElixir.Opencode.Generated.AgentConfig.t() | nil,
          plan: HiveServerElixir.Opencode.Generated.AgentConfig.t() | nil,
          summary: HiveServerElixir.Opencode.Generated.AgentConfig.t() | nil,
          title: HiveServerElixir.Opencode.Generated.AgentConfig.t() | nil
        }

  defstruct [:build, :compaction, :explore, :general, :plan, :summary, :title]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      build: {HiveServerElixir.Opencode.Generated.AgentConfig, :t},
      compaction: {HiveServerElixir.Opencode.Generated.AgentConfig, :t},
      explore: {HiveServerElixir.Opencode.Generated.AgentConfig, :t},
      general: {HiveServerElixir.Opencode.Generated.AgentConfig, :t},
      plan: {HiveServerElixir.Opencode.Generated.AgentConfig, :t},
      summary: {HiveServerElixir.Opencode.Generated.AgentConfig, :t},
      title: {HiveServerElixir.Opencode.Generated.AgentConfig, :t}
    ]
  end
end

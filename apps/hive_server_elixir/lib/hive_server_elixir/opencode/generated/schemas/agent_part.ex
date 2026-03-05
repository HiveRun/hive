defmodule HiveServerElixir.Opencode.Generated.AgentPart do
  @moduledoc """
  Provides struct and type for a AgentPart
  """

  @type t :: %__MODULE__{
          id: String.t(),
          messageID: String.t(),
          name: String.t(),
          sessionID: String.t(),
          source: HiveServerElixir.Opencode.Generated.AgentPartSource.t() | nil,
          type: String.t()
        }

  defstruct [:id, :messageID, :name, :sessionID, :source, :type]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      id: :string,
      messageID: :string,
      name: :string,
      sessionID: :string,
      source: {HiveServerElixir.Opencode.Generated.AgentPartSource, :t},
      type: {:const, "agent"}
    ]
  end
end

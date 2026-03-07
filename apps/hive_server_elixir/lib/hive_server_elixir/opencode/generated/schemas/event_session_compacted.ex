defmodule HiveServerElixir.Opencode.Generated.EventSessionCompacted do
  @moduledoc """
  Provides struct and type for a EventSessionCompacted
  """

  @type t :: %__MODULE__{
          properties: HiveServerElixir.Opencode.Generated.EventSessionCompactedProperties.t(),
          type: String.t()
        }

  defstruct [:properties, :type]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      properties: {HiveServerElixir.Opencode.Generated.EventSessionCompactedProperties, :t},
      type: {:const, "session.compacted"}
    ]
  end
end

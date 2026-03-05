defmodule HiveServerElixir.Opencode.Generated.EventMessageUpdated do
  @moduledoc """
  Provides struct and type for a EventMessageUpdated
  """

  @type t :: %__MODULE__{
          properties: HiveServerElixir.Opencode.Generated.EventMessageUpdatedProperties.t(),
          type: String.t()
        }

  defstruct [:properties, :type]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      properties: {HiveServerElixir.Opencode.Generated.EventMessageUpdatedProperties, :t},
      type: {:const, "message.updated"}
    ]
  end
end

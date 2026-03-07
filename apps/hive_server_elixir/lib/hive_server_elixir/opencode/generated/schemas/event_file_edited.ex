defmodule HiveServerElixir.Opencode.Generated.EventFileEdited do
  @moduledoc """
  Provides struct and type for a EventFileEdited
  """

  @type t :: %__MODULE__{
          properties: HiveServerElixir.Opencode.Generated.EventFileEditedProperties.t(),
          type: String.t()
        }

  defstruct [:properties, :type]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      properties: {HiveServerElixir.Opencode.Generated.EventFileEditedProperties, :t},
      type: {:const, "file.edited"}
    ]
  end
end

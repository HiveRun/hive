defmodule HiveServerElixir.Opencode.Generated.EventMessagePartDeltaProperties do
  @moduledoc """
  Provides struct and type for a EventMessagePartDeltaProperties
  """

  @type t :: %__MODULE__{
          delta: String.t(),
          field: String.t(),
          messageID: String.t(),
          partID: String.t(),
          sessionID: String.t()
        }

  defstruct [:delta, :field, :messageID, :partID, :sessionID]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [delta: :string, field: :string, messageID: :string, partID: :string, sessionID: :string]
  end
end

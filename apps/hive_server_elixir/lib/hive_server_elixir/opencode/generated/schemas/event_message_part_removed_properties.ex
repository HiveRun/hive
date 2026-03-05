defmodule HiveServerElixir.Opencode.Generated.EventMessagePartRemovedProperties do
  @moduledoc """
  Provides struct and type for a EventMessagePartRemovedProperties
  """

  @type t :: %__MODULE__{messageID: String.t(), partID: String.t(), sessionID: String.t()}

  defstruct [:messageID, :partID, :sessionID]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [messageID: :string, partID: :string, sessionID: :string]
  end
end

defmodule HiveServerElixir.Opencode.Generated.EventMessageRemovedProperties do
  @moduledoc """
  Provides struct and type for a EventMessageRemovedProperties
  """

  @type t :: %__MODULE__{messageID: String.t(), sessionID: String.t()}

  defstruct [:messageID, :sessionID]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [messageID: :string, sessionID: :string]
  end
end

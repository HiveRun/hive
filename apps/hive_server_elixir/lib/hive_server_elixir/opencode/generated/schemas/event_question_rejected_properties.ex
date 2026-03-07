defmodule HiveServerElixir.Opencode.Generated.EventQuestionRejectedProperties do
  @moduledoc """
  Provides struct and type for a EventQuestionRejectedProperties
  """

  @type t :: %__MODULE__{requestID: String.t(), sessionID: String.t()}

  defstruct [:requestID, :sessionID]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [requestID: :string, sessionID: :string]
  end
end

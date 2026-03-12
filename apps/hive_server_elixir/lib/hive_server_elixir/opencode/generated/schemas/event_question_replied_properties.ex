defmodule HiveServerElixir.Opencode.Generated.EventQuestionRepliedProperties do
  @moduledoc """
  Provides struct and type for a EventQuestionRepliedProperties
  """

  @type t :: %__MODULE__{answers: [[String.t()]], requestID: String.t(), sessionID: String.t()}

  defstruct [:answers, :requestID, :sessionID]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [answers: [[:string]], requestID: :string, sessionID: :string]
  end
end

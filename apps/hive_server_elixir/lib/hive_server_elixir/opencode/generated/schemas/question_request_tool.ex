defmodule HiveServerElixir.Opencode.Generated.QuestionRequestTool do
  @moduledoc """
  Provides struct and type for a QuestionRequestTool
  """

  @type t :: %__MODULE__{callID: String.t(), messageID: String.t()}

  defstruct [:callID, :messageID]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [callID: :string, messageID: :string]
  end
end

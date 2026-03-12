defmodule HiveServerElixir.Opencode.Generated.QuestionRequest do
  @moduledoc """
  Provides struct and type for a QuestionRequest
  """

  @type t :: %__MODULE__{
          id: String.t(),
          questions: [HiveServerElixir.Opencode.Generated.QuestionInfo.t()],
          sessionID: String.t(),
          tool: HiveServerElixir.Opencode.Generated.QuestionRequestTool.t() | nil
        }

  defstruct [:id, :questions, :sessionID, :tool]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      id: :string,
      questions: [{HiveServerElixir.Opencode.Generated.QuestionInfo, :t}],
      sessionID: :string,
      tool: {HiveServerElixir.Opencode.Generated.QuestionRequestTool, :t}
    ]
  end
end

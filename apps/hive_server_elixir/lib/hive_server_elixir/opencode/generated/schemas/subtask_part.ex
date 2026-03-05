defmodule HiveServerElixir.Opencode.Generated.SubtaskPart do
  @moduledoc """
  Provides struct and type for a SubtaskPart
  """

  @type t :: %__MODULE__{
          agent: String.t(),
          command: String.t() | nil,
          description: String.t(),
          id: String.t(),
          messageID: String.t(),
          model: HiveServerElixir.Opencode.Generated.SubtaskPartModel.t() | nil,
          prompt: String.t(),
          sessionID: String.t(),
          type: String.t()
        }

  defstruct [:agent, :command, :description, :id, :messageID, :model, :prompt, :sessionID, :type]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      agent: :string,
      command: :string,
      description: :string,
      id: :string,
      messageID: :string,
      model: {HiveServerElixir.Opencode.Generated.SubtaskPartModel, :t},
      prompt: :string,
      sessionID: :string,
      type: {:const, "subtask"}
    ]
  end
end

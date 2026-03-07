defmodule HiveServerElixir.Opencode.Generated.StepFinishPart do
  @moduledoc """
  Provides struct and type for a StepFinishPart
  """

  @type t :: %__MODULE__{
          cost: number,
          id: String.t(),
          messageID: String.t(),
          reason: String.t(),
          sessionID: String.t(),
          snapshot: String.t() | nil,
          tokens: HiveServerElixir.Opencode.Generated.StepFinishPartTokens.t(),
          type: String.t()
        }

  defstruct [:cost, :id, :messageID, :reason, :sessionID, :snapshot, :tokens, :type]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      cost: :number,
      id: :string,
      messageID: :string,
      reason: :string,
      sessionID: :string,
      snapshot: :string,
      tokens: {HiveServerElixir.Opencode.Generated.StepFinishPartTokens, :t},
      type: {:const, "step-finish"}
    ]
  end
end

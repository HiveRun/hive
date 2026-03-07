defmodule HiveServerElixir.Opencode.Generated.StepStartPart do
  @moduledoc """
  Provides struct and type for a StepStartPart
  """

  @type t :: %__MODULE__{
          id: String.t(),
          messageID: String.t(),
          sessionID: String.t(),
          snapshot: String.t() | nil,
          type: String.t()
        }

  defstruct [:id, :messageID, :sessionID, :snapshot, :type]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      id: :string,
      messageID: :string,
      sessionID: :string,
      snapshot: :string,
      type: {:const, "step-start"}
    ]
  end
end

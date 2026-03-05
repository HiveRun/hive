defmodule HiveServerElixir.Opencode.Generated.PatchPart do
  @moduledoc """
  Provides struct and type for a PatchPart
  """

  @type t :: %__MODULE__{
          files: [String.t()],
          hash: String.t(),
          id: String.t(),
          messageID: String.t(),
          sessionID: String.t(),
          type: String.t()
        }

  defstruct [:files, :hash, :id, :messageID, :sessionID, :type]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      files: [:string],
      hash: :string,
      id: :string,
      messageID: :string,
      sessionID: :string,
      type: {:const, "patch"}
    ]
  end
end

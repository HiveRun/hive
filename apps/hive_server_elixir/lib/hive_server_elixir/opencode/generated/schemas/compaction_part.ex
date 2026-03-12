defmodule HiveServerElixir.Opencode.Generated.CompactionPart do
  @moduledoc """
  Provides struct and type for a CompactionPart
  """

  @type t :: %__MODULE__{
          auto: boolean,
          id: String.t(),
          messageID: String.t(),
          overflow: boolean | nil,
          sessionID: String.t(),
          type: String.t()
        }

  defstruct [:auto, :id, :messageID, :overflow, :sessionID, :type]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      auto: :boolean,
      id: :string,
      messageID: :string,
      overflow: :boolean,
      sessionID: :string,
      type: {:const, "compaction"}
    ]
  end
end

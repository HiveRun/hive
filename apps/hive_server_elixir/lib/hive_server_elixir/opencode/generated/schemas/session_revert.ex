defmodule HiveServerElixir.Opencode.Generated.SessionRevert do
  @moduledoc """
  Provides struct and type for a SessionRevert
  """

  @type t :: %__MODULE__{
          diff: String.t() | nil,
          messageID: String.t(),
          partID: String.t() | nil,
          snapshot: String.t() | nil
        }

  defstruct [:diff, :messageID, :partID, :snapshot]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [diff: :string, messageID: :string, partID: :string, snapshot: :string]
  end
end

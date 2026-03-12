defmodule HiveServerElixir.Opencode.Generated.FileContentPatch do
  @moduledoc """
  Provides struct and type for a FileContentPatch
  """

  @type t :: %__MODULE__{
          hunks: [HiveServerElixir.Opencode.Generated.FileContentPatchHunks.t()],
          index: String.t() | nil,
          newFileName: String.t(),
          newHeader: String.t() | nil,
          oldFileName: String.t(),
          oldHeader: String.t() | nil
        }

  defstruct [:hunks, :index, :newFileName, :newHeader, :oldFileName, :oldHeader]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      hunks: [{HiveServerElixir.Opencode.Generated.FileContentPatchHunks, :t}],
      index: :string,
      newFileName: :string,
      newHeader: :string,
      oldFileName: :string,
      oldHeader: :string
    ]
  end
end

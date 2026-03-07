defmodule HiveServerElixir.Opencode.Generated.FileContentPatchHunks do
  @moduledoc """
  Provides struct and type for a FileContentPatchHunks
  """

  @type t :: %__MODULE__{
          lines: [String.t()],
          newLines: number,
          newStart: number,
          oldLines: number,
          oldStart: number
        }

  defstruct [:lines, :newLines, :newStart, :oldLines, :oldStart]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [lines: [:string], newLines: :number, newStart: :number, oldLines: :number, oldStart: :number]
  end
end

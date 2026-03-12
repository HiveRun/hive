defmodule HiveServerElixir.Opencode.Generated.Range do
  @moduledoc """
  Provides struct and type for a Range
  """

  @type t :: %__MODULE__{
          end: HiveServerElixir.Opencode.Generated.RangeEnd.t(),
          start: HiveServerElixir.Opencode.Generated.RangeStart.t()
        }

  defstruct [:end, :start]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      end: {HiveServerElixir.Opencode.Generated.RangeEnd, :t},
      start: {HiveServerElixir.Opencode.Generated.RangeStart, :t}
    ]
  end
end

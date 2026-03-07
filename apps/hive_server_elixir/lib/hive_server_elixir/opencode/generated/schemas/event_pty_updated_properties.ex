defmodule HiveServerElixir.Opencode.Generated.EventPtyUpdatedProperties do
  @moduledoc """
  Provides struct and type for a EventPtyUpdatedProperties
  """

  @type t :: %__MODULE__{info: HiveServerElixir.Opencode.Generated.Pty.t()}

  defstruct [:info]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [info: {HiveServerElixir.Opencode.Generated.Pty, :t}]
  end
end

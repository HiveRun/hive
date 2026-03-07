defmodule HiveServerElixir.Opencode.Generated.EventSessionCreatedProperties do
  @moduledoc """
  Provides struct and type for a EventSessionCreatedProperties
  """

  @type t :: %__MODULE__{info: HiveServerElixir.Opencode.Generated.Session.t()}

  defstruct [:info]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [info: {HiveServerElixir.Opencode.Generated.Session, :t}]
  end
end

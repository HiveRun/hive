defmodule HiveServerElixir.Opencode.Generated.EventSessionCompactedProperties do
  @moduledoc """
  Provides struct and type for a EventSessionCompactedProperties
  """

  @type t :: %__MODULE__{sessionID: String.t()}

  defstruct [:sessionID]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [sessionID: :string]
  end
end

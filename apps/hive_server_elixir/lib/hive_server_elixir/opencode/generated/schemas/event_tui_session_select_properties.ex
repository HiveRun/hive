defmodule HiveServerElixir.Opencode.Generated.EventTuiSessionSelectProperties do
  @moduledoc """
  Provides struct and type for a EventTuiSessionSelectProperties
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

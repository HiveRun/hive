defmodule HiveServerElixir.Opencode.Generated.EventCommandExecutedProperties do
  @moduledoc """
  Provides struct and type for a EventCommandExecutedProperties
  """

  @type t :: %__MODULE__{
          arguments: String.t(),
          messageID: String.t(),
          name: String.t(),
          sessionID: String.t()
        }

  defstruct [:arguments, :messageID, :name, :sessionID]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [arguments: :string, messageID: :string, name: :string, sessionID: :string]
  end
end

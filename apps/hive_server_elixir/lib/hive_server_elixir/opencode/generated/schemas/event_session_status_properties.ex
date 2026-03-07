defmodule HiveServerElixir.Opencode.Generated.EventSessionStatusProperties do
  @moduledoc """
  Provides struct and type for a EventSessionStatusProperties
  """

  @type t :: %__MODULE__{
          sessionID: String.t(),
          status: HiveServerElixir.Opencode.Generated.EventSessionStatusPropertiesStatus.t()
        }

  defstruct [:sessionID, :status]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      sessionID: :string,
      status: {HiveServerElixir.Opencode.Generated.EventSessionStatusPropertiesStatus, :t}
    ]
  end
end

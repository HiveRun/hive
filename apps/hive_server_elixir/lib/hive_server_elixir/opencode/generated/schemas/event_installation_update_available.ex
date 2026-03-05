defmodule HiveServerElixir.Opencode.Generated.EventInstallationUpdateAvailable do
  @moduledoc """
  Provides struct and type for a EventInstallationUpdateAvailable
  """

  @type t :: %__MODULE__{
          properties:
            HiveServerElixir.Opencode.Generated.EventInstallationUpdateAvailableProperties.t(),
          type: String.t()
        }

  defstruct [:properties, :type]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      properties:
        {HiveServerElixir.Opencode.Generated.EventInstallationUpdateAvailableProperties, :t},
      type: {:const, "installation.update-available"}
    ]
  end
end

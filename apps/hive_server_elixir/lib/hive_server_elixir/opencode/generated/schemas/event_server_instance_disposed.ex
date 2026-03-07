defmodule HiveServerElixir.Opencode.Generated.EventServerInstanceDisposed do
  @moduledoc """
  Provides struct and type for a EventServerInstanceDisposed
  """

  @type t :: %__MODULE__{
          properties:
            HiveServerElixir.Opencode.Generated.EventServerInstanceDisposedProperties.t(),
          type: String.t()
        }

  defstruct [:properties, :type]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      properties: {HiveServerElixir.Opencode.Generated.EventServerInstanceDisposedProperties, :t},
      type: {:const, "server.instance.disposed"}
    ]
  end
end

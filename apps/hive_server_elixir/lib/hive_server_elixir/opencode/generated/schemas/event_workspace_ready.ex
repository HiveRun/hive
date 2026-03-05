defmodule HiveServerElixir.Opencode.Generated.EventWorkspaceReady do
  @moduledoc """
  Provides struct and type for a EventWorkspaceReady
  """

  @type t :: %__MODULE__{
          properties: HiveServerElixir.Opencode.Generated.EventWorkspaceReadyProperties.t(),
          type: String.t()
        }

  defstruct [:properties, :type]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      properties: {HiveServerElixir.Opencode.Generated.EventWorkspaceReadyProperties, :t},
      type: {:const, "workspace.ready"}
    ]
  end
end

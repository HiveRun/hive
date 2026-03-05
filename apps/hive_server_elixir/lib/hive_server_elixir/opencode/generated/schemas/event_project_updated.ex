defmodule HiveServerElixir.Opencode.Generated.EventProjectUpdated do
  @moduledoc """
  Provides struct and type for a EventProjectUpdated
  """

  @type t :: %__MODULE__{
          properties: HiveServerElixir.Opencode.Generated.Project.t(),
          type: String.t()
        }

  defstruct [:properties, :type]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      properties: {HiveServerElixir.Opencode.Generated.Project, :t},
      type: {:const, "project.updated"}
    ]
  end
end

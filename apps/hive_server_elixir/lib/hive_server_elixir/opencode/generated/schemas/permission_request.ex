defmodule HiveServerElixir.Opencode.Generated.PermissionRequest do
  @moduledoc """
  Provides struct and type for a PermissionRequest
  """

  @type t :: %__MODULE__{
          always: [String.t()],
          id: String.t(),
          metadata: map,
          patterns: [String.t()],
          permission: String.t(),
          sessionID: String.t(),
          tool: HiveServerElixir.Opencode.Generated.PermissionRequestTool.t() | nil
        }

  defstruct [:always, :id, :metadata, :patterns, :permission, :sessionID, :tool]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      always: [:string],
      id: :string,
      metadata: :map,
      patterns: [:string],
      permission: :string,
      sessionID: :string,
      tool: {HiveServerElixir.Opencode.Generated.PermissionRequestTool, :t}
    ]
  end
end

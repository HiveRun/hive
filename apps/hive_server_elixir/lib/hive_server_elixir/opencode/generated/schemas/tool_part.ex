defmodule HiveServerElixir.Opencode.Generated.ToolPart do
  @moduledoc """
  Provides struct and type for a ToolPart
  """

  @type t :: %__MODULE__{
          callID: String.t(),
          id: String.t(),
          messageID: String.t(),
          metadata: map | nil,
          sessionID: String.t(),
          state:
            HiveServerElixir.Opencode.Generated.ToolStateCompleted.t()
            | HiveServerElixir.Opencode.Generated.ToolStateError.t()
            | HiveServerElixir.Opencode.Generated.ToolStatePending.t()
            | HiveServerElixir.Opencode.Generated.ToolStateRunning.t(),
          tool: String.t(),
          type: String.t()
        }

  defstruct [:callID, :id, :messageID, :metadata, :sessionID, :state, :tool, :type]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      callID: :string,
      id: :string,
      messageID: :string,
      metadata: :map,
      sessionID: :string,
      state:
        {:union,
         [
           {HiveServerElixir.Opencode.Generated.ToolStateCompleted, :t},
           {HiveServerElixir.Opencode.Generated.ToolStateError, :t},
           {HiveServerElixir.Opencode.Generated.ToolStatePending, :t},
           {HiveServerElixir.Opencode.Generated.ToolStateRunning, :t}
         ]},
      tool: :string,
      type: {:const, "tool"}
    ]
  end
end

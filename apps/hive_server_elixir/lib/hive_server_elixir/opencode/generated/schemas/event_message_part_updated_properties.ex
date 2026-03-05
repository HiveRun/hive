defmodule HiveServerElixir.Opencode.Generated.EventMessagePartUpdatedProperties do
  @moduledoc """
  Provides struct and type for a EventMessagePartUpdatedProperties
  """

  @type t :: %__MODULE__{
          part:
            HiveServerElixir.Opencode.Generated.AgentPart.t()
            | HiveServerElixir.Opencode.Generated.CompactionPart.t()
            | HiveServerElixir.Opencode.Generated.FilePart.t()
            | HiveServerElixir.Opencode.Generated.PatchPart.t()
            | HiveServerElixir.Opencode.Generated.ReasoningPart.t()
            | HiveServerElixir.Opencode.Generated.RetryPart.t()
            | HiveServerElixir.Opencode.Generated.SnapshotPart.t()
            | HiveServerElixir.Opencode.Generated.StepFinishPart.t()
            | HiveServerElixir.Opencode.Generated.StepStartPart.t()
            | HiveServerElixir.Opencode.Generated.SubtaskPart.t()
            | HiveServerElixir.Opencode.Generated.TextPart.t()
            | HiveServerElixir.Opencode.Generated.ToolPart.t()
        }

  defstruct [:part]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      part:
        {:union,
         [
           {HiveServerElixir.Opencode.Generated.AgentPart, :t},
           {HiveServerElixir.Opencode.Generated.CompactionPart, :t},
           {HiveServerElixir.Opencode.Generated.FilePart, :t},
           {HiveServerElixir.Opencode.Generated.PatchPart, :t},
           {HiveServerElixir.Opencode.Generated.ReasoningPart, :t},
           {HiveServerElixir.Opencode.Generated.RetryPart, :t},
           {HiveServerElixir.Opencode.Generated.SnapshotPart, :t},
           {HiveServerElixir.Opencode.Generated.StepFinishPart, :t},
           {HiveServerElixir.Opencode.Generated.StepStartPart, :t},
           {HiveServerElixir.Opencode.Generated.SubtaskPart, :t},
           {HiveServerElixir.Opencode.Generated.TextPart, :t},
           {HiveServerElixir.Opencode.Generated.ToolPart, :t}
         ]}
    ]
  end
end

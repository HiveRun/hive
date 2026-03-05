defmodule HiveServerElixir.Opencode.Generated.EventSessionDiffProperties do
  @moduledoc """
  Provides struct and type for a EventSessionDiffProperties
  """

  @type t :: %__MODULE__{
          diff: [HiveServerElixir.Opencode.Generated.FileDiff.t()],
          sessionID: String.t()
        }

  defstruct [:diff, :sessionID]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [diff: [{HiveServerElixir.Opencode.Generated.FileDiff, :t}], sessionID: :string]
  end
end

defmodule HiveServerElixir.Opencode.Generated.UserMessageSummary do
  @moduledoc """
  Provides struct and type for a UserMessageSummary
  """

  @type t :: %__MODULE__{
          body: String.t() | nil,
          diffs: [HiveServerElixir.Opencode.Generated.FileDiff.t()],
          title: String.t() | nil
        }

  defstruct [:body, :diffs, :title]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [body: :string, diffs: [{HiveServerElixir.Opencode.Generated.FileDiff, :t}], title: :string]
  end
end

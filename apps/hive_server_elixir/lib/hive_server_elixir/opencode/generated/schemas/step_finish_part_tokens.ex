defmodule HiveServerElixir.Opencode.Generated.StepFinishPartTokens do
  @moduledoc """
  Provides struct and type for a StepFinishPartTokens
  """

  @type t :: %__MODULE__{
          cache: HiveServerElixir.Opencode.Generated.StepFinishPartTokensCache.t(),
          input: number,
          output: number,
          reasoning: number,
          total: number | nil
        }

  defstruct [:cache, :input, :output, :reasoning, :total]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      cache: {HiveServerElixir.Opencode.Generated.StepFinishPartTokensCache, :t},
      input: :number,
      output: :number,
      reasoning: :number,
      total: :number
    ]
  end
end

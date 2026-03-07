defmodule HiveServerElixir.Opencode.Generated.ContextOverflowErrorData do
  @moduledoc """
  Provides struct and type for a ContextOverflowErrorData
  """

  @type t :: %__MODULE__{message: String.t(), responseBody: String.t() | nil}

  defstruct [:message, :responseBody]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [message: :string, responseBody: :string]
  end
end

defmodule HiveServerElixir.Opencode.Generated.WorktreeCreateInput do
  @moduledoc """
  Provides struct and type for a WorktreeCreateInput
  """

  @type t :: %__MODULE__{name: String.t() | nil, startCommand: String.t() | nil}

  defstruct [:name, :startCommand]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [name: :string, startCommand: :string]
  end
end

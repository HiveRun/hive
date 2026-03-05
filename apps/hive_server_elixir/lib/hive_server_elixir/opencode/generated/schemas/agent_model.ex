defmodule HiveServerElixir.Opencode.Generated.AgentModel do
  @moduledoc """
  Provides struct and type for a AgentModel
  """

  @type t :: %__MODULE__{modelID: String.t(), providerID: String.t()}

  defstruct [:modelID, :providerID]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [modelID: :string, providerID: :string]
  end
end

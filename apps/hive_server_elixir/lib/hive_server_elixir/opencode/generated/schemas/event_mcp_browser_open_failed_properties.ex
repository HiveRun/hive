defmodule HiveServerElixir.Opencode.Generated.EventMcpBrowserOpenFailedProperties do
  @moduledoc """
  Provides struct and type for a EventMcpBrowserOpenFailedProperties
  """

  @type t :: %__MODULE__{mcpName: String.t(), url: String.t()}

  defstruct [:mcpName, :url]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [mcpName: :string, url: :string]
  end
end

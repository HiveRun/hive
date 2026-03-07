defmodule HiveServerElixir.Opencode.Generated.EventLspClientDiagnosticsProperties do
  @moduledoc """
  Provides struct and type for a EventLspClientDiagnosticsProperties
  """

  @type t :: %__MODULE__{path: String.t(), serverID: String.t()}

  defstruct [:path, :serverID]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [path: :string, serverID: :string]
  end
end

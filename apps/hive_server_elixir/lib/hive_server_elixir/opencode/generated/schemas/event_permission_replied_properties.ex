defmodule HiveServerElixir.Opencode.Generated.EventPermissionRepliedProperties do
  @moduledoc """
  Provides struct and type for a EventPermissionRepliedProperties
  """

  @type t :: %__MODULE__{reply: String.t(), requestID: String.t(), sessionID: String.t()}

  defstruct [:reply, :requestID, :sessionID]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [reply: {:enum, ["once", "always", "reject"]}, requestID: :string, sessionID: :string]
  end
end

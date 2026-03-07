defmodule HiveServerElixir.Opencode.Generated.McpOAuthConfig do
  @moduledoc """
  Provides struct and type for a McpOAuthConfig
  """

  @type t :: %__MODULE__{
          clientId: String.t() | nil,
          clientSecret: String.t() | nil,
          scope: String.t() | nil
        }

  defstruct [:clientId, :clientSecret, :scope]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [clientId: :string, clientSecret: :string, scope: :string]
  end
end

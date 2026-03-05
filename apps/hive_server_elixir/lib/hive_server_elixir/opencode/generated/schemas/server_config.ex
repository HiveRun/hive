defmodule HiveServerElixir.Opencode.Generated.ServerConfig do
  @moduledoc """
  Provides struct and type for a ServerConfig
  """

  @type t :: %__MODULE__{
          cors: [String.t()] | nil,
          hostname: String.t() | nil,
          mdns: boolean | nil,
          mdnsDomain: String.t() | nil,
          port: integer | nil
        }

  defstruct [:cors, :hostname, :mdns, :mdnsDomain, :port]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [cors: [:string], hostname: :string, mdns: :boolean, mdnsDomain: :string, port: :integer]
  end
end

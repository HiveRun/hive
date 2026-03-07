defmodule HiveServerElixir.Opencode.Generated.OutputFormatJsonSchema do
  @moduledoc """
  Provides struct and type for a OutputFormatJsonSchema
  """

  @type t :: %__MODULE__{retryCount: integer | nil, schema: map, type: String.t()}

  defstruct [:retryCount, :schema, :type]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [retryCount: :integer, schema: :map, type: {:const, "json_schema"}]
  end
end

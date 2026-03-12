defmodule HiveServerElixir.Opencode.Generated.APIErrorData do
  @moduledoc """
  Provides struct and type for a APIErrorData
  """

  @type t :: %__MODULE__{
          isRetryable: boolean,
          message: String.t(),
          metadata: map | nil,
          responseBody: String.t() | nil,
          responseHeaders: map | nil,
          statusCode: number | nil
        }

  defstruct [:isRetryable, :message, :metadata, :responseBody, :responseHeaders, :statusCode]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      isRetryable: :boolean,
      message: :string,
      metadata: :map,
      responseBody: :string,
      responseHeaders: :map,
      statusCode: :number
    ]
  end
end

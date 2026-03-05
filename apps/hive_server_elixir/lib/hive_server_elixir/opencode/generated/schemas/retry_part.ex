defmodule HiveServerElixir.Opencode.Generated.RetryPart do
  @moduledoc """
  Provides struct and type for a RetryPart
  """

  @type t :: %__MODULE__{
          attempt: number,
          error: HiveServerElixir.Opencode.Generated.APIError.t(),
          id: String.t(),
          messageID: String.t(),
          sessionID: String.t(),
          time: HiveServerElixir.Opencode.Generated.RetryPartTime.t(),
          type: String.t()
        }

  defstruct [:attempt, :error, :id, :messageID, :sessionID, :time, :type]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      attempt: :number,
      error: {HiveServerElixir.Opencode.Generated.APIError, :t},
      id: :string,
      messageID: :string,
      sessionID: :string,
      time: {HiveServerElixir.Opencode.Generated.RetryPartTime, :t},
      type: {:const, "retry"}
    ]
  end
end

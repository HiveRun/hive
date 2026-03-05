defmodule HiveServerElixir.Opencode.Generated.EventSessionErrorProperties do
  @moduledoc """
  Provides struct and type for a EventSessionErrorProperties
  """

  @type t :: %__MODULE__{
          error:
            HiveServerElixir.Opencode.Generated.APIError.t()
            | HiveServerElixir.Opencode.Generated.ContextOverflowError.t()
            | HiveServerElixir.Opencode.Generated.MessageAbortedError.t()
            | HiveServerElixir.Opencode.Generated.MessageOutputLengthError.t()
            | HiveServerElixir.Opencode.Generated.ProviderAuthError.t()
            | HiveServerElixir.Opencode.Generated.StructuredOutputError.t()
            | HiveServerElixir.Opencode.Generated.UnknownError.t()
            | nil,
          sessionID: String.t() | nil
        }

  defstruct [:error, :sessionID]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      error:
        {:union,
         [
           {HiveServerElixir.Opencode.Generated.APIError, :t},
           {HiveServerElixir.Opencode.Generated.ContextOverflowError, :t},
           {HiveServerElixir.Opencode.Generated.MessageAbortedError, :t},
           {HiveServerElixir.Opencode.Generated.MessageOutputLengthError, :t},
           {HiveServerElixir.Opencode.Generated.ProviderAuthError, :t},
           {HiveServerElixir.Opencode.Generated.StructuredOutputError, :t},
           {HiveServerElixir.Opencode.Generated.UnknownError, :t}
         ]},
      sessionID: :string
    ]
  end
end

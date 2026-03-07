defmodule HiveServerElixir.Opencode.Generated.AssistantMessage do
  @moduledoc """
  Provides struct and type for a AssistantMessage
  """

  @type t :: %__MODULE__{
          agent: String.t(),
          cost: number,
          error:
            HiveServerElixir.Opencode.Generated.APIError.t()
            | HiveServerElixir.Opencode.Generated.ContextOverflowError.t()
            | HiveServerElixir.Opencode.Generated.MessageAbortedError.t()
            | HiveServerElixir.Opencode.Generated.MessageOutputLengthError.t()
            | HiveServerElixir.Opencode.Generated.ProviderAuthError.t()
            | HiveServerElixir.Opencode.Generated.StructuredOutputError.t()
            | HiveServerElixir.Opencode.Generated.UnknownError.t()
            | nil,
          finish: String.t() | nil,
          id: String.t(),
          mode: String.t(),
          modelID: String.t(),
          parentID: String.t(),
          path: HiveServerElixir.Opencode.Generated.AssistantMessagePath.t(),
          providerID: String.t(),
          role: String.t(),
          sessionID: String.t(),
          structured: map | nil,
          summary: boolean | nil,
          time: HiveServerElixir.Opencode.Generated.AssistantMessageTime.t(),
          tokens: HiveServerElixir.Opencode.Generated.AssistantMessageTokens.t(),
          variant: String.t() | nil
        }

  defstruct [
    :agent,
    :cost,
    :error,
    :finish,
    :id,
    :mode,
    :modelID,
    :parentID,
    :path,
    :providerID,
    :role,
    :sessionID,
    :structured,
    :summary,
    :time,
    :tokens,
    :variant
  ]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      agent: :string,
      cost: :number,
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
      finish: :string,
      id: :string,
      mode: :string,
      modelID: :string,
      parentID: :string,
      path: {HiveServerElixir.Opencode.Generated.AssistantMessagePath, :t},
      providerID: :string,
      role: {:const, "assistant"},
      sessionID: :string,
      structured: :map,
      summary: :boolean,
      time: {HiveServerElixir.Opencode.Generated.AssistantMessageTime, :t},
      tokens: {HiveServerElixir.Opencode.Generated.AssistantMessageTokens, :t},
      variant: :string
    ]
  end
end

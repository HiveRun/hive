defmodule HiveServerElixir.Opencode.Generated.UserMessage do
  @moduledoc """
  Provides struct and type for a UserMessage
  """

  @type t :: %__MODULE__{
          agent: String.t(),
          format:
            HiveServerElixir.Opencode.Generated.OutputFormatJsonSchema.t()
            | HiveServerElixir.Opencode.Generated.OutputFormatText.t()
            | nil,
          id: String.t(),
          model: HiveServerElixir.Opencode.Generated.UserMessageModel.t(),
          role: String.t(),
          sessionID: String.t(),
          summary: HiveServerElixir.Opencode.Generated.UserMessageSummary.t() | nil,
          system: String.t() | nil,
          time: HiveServerElixir.Opencode.Generated.UserMessageTime.t(),
          tools: map | nil,
          variant: String.t() | nil
        }

  defstruct [
    :agent,
    :format,
    :id,
    :model,
    :role,
    :sessionID,
    :summary,
    :system,
    :time,
    :tools,
    :variant
  ]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      agent: :string,
      format:
        {:union,
         [
           {HiveServerElixir.Opencode.Generated.OutputFormatJsonSchema, :t},
           {HiveServerElixir.Opencode.Generated.OutputFormatText, :t}
         ]},
      id: :string,
      model: {HiveServerElixir.Opencode.Generated.UserMessageModel, :t},
      role: {:const, "user"},
      sessionID: :string,
      summary: {HiveServerElixir.Opencode.Generated.UserMessageSummary, :t},
      system: :string,
      time: {HiveServerElixir.Opencode.Generated.UserMessageTime, :t},
      tools: :map,
      variant: :string
    ]
  end
end

defmodule HiveServerElixir.Opencode.Generated.TextPart do
  @moduledoc """
  Provides struct and type for a TextPart
  """

  @type t :: %__MODULE__{
          id: String.t(),
          ignored: boolean | nil,
          messageID: String.t(),
          metadata: map | nil,
          sessionID: String.t(),
          synthetic: boolean | nil,
          text: String.t(),
          time: HiveServerElixir.Opencode.Generated.TextPartTime.t() | nil,
          type: String.t()
        }

  defstruct [:id, :ignored, :messageID, :metadata, :sessionID, :synthetic, :text, :time, :type]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      id: :string,
      ignored: :boolean,
      messageID: :string,
      metadata: :map,
      sessionID: :string,
      synthetic: :boolean,
      text: :string,
      time: {HiveServerElixir.Opencode.Generated.TextPartTime, :t},
      type: {:const, "text"}
    ]
  end
end

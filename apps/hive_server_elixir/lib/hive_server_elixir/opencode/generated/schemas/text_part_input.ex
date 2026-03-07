defmodule HiveServerElixir.Opencode.Generated.TextPartInput do
  @moduledoc """
  Provides struct and type for a TextPartInput
  """

  @type t :: %__MODULE__{
          id: String.t() | nil,
          ignored: boolean | nil,
          metadata: map | nil,
          synthetic: boolean | nil,
          text: String.t(),
          time: HiveServerElixir.Opencode.Generated.TextPartInputTime.t() | nil,
          type: String.t()
        }

  defstruct [:id, :ignored, :metadata, :synthetic, :text, :time, :type]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      id: :string,
      ignored: :boolean,
      metadata: :map,
      synthetic: :boolean,
      text: :string,
      time: {HiveServerElixir.Opencode.Generated.TextPartInputTime, :t},
      type: {:const, "text"}
    ]
  end
end

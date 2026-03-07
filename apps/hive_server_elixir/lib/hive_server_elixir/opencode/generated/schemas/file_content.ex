defmodule HiveServerElixir.Opencode.Generated.FileContent do
  @moduledoc """
  Provides struct and type for a FileContent
  """

  @type t :: %__MODULE__{
          content: String.t(),
          diff: String.t() | nil,
          encoding: String.t() | nil,
          mimeType: String.t() | nil,
          patch: HiveServerElixir.Opencode.Generated.FileContentPatch.t() | nil,
          type: String.t()
        }

  defstruct [:content, :diff, :encoding, :mimeType, :patch, :type]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      content: :string,
      diff: :string,
      encoding: {:const, "base64"},
      mimeType: :string,
      patch: {HiveServerElixir.Opencode.Generated.FileContentPatch, :t},
      type: {:enum, ["text", "binary"]}
    ]
  end
end

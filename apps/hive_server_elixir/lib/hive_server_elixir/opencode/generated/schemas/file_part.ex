defmodule HiveServerElixir.Opencode.Generated.FilePart do
  @moduledoc """
  Provides struct and type for a FilePart
  """

  @type t :: %__MODULE__{
          filename: String.t() | nil,
          id: String.t(),
          messageID: String.t(),
          mime: String.t(),
          sessionID: String.t(),
          source:
            HiveServerElixir.Opencode.Generated.FileSource.t()
            | HiveServerElixir.Opencode.Generated.ResourceSource.t()
            | HiveServerElixir.Opencode.Generated.SymbolSource.t()
            | nil,
          type: String.t(),
          url: String.t()
        }

  defstruct [:filename, :id, :messageID, :mime, :sessionID, :source, :type, :url]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      filename: :string,
      id: :string,
      messageID: :string,
      mime: :string,
      sessionID: :string,
      source:
        {:union,
         [
           {HiveServerElixir.Opencode.Generated.FileSource, :t},
           {HiveServerElixir.Opencode.Generated.ResourceSource, :t},
           {HiveServerElixir.Opencode.Generated.SymbolSource, :t}
         ]},
      type: {:const, "file"},
      url: :string
    ]
  end
end

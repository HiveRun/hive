defmodule HiveServerElixir.Opencode.Generated.QuestionInfo do
  @moduledoc """
  Provides struct and type for a QuestionInfo
  """

  @type t :: %__MODULE__{
          custom: boolean | nil,
          header: String.t(),
          multiple: boolean | nil,
          options: [HiveServerElixir.Opencode.Generated.QuestionOption.t()],
          question: String.t()
        }

  defstruct [:custom, :header, :multiple, :options, :question]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      custom: :boolean,
      header: :string,
      multiple: :boolean,
      options: [{HiveServerElixir.Opencode.Generated.QuestionOption, :t}],
      question: :string
    ]
  end
end

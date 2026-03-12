defmodule HiveServerElixir.Opencode.Generated.NotFoundError do
  @moduledoc """
  Provides struct and type for a NotFoundError
  """

  @type t :: %__MODULE__{
          data: HiveServerElixir.Opencode.Generated.NotFoundErrorData.t(),
          name: String.t()
        }

  defstruct [:data, :name]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      data: {HiveServerElixir.Opencode.Generated.NotFoundErrorData, :t},
      name: {:const, "NotFoundError"}
    ]
  end
end

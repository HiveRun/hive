defmodule HiveServerElixir.Opencode.Generated.Workspace do
  @moduledoc """
  Provides struct and type for a Workspace
  """

  @type t :: %__MODULE__{
          branch: String.t() | nil,
          directory: String.t() | nil,
          extra: map | nil,
          id: String.t(),
          name: String.t() | nil,
          projectID: String.t(),
          type: String.t()
        }

  defstruct [:branch, :directory, :extra, :id, :name, :projectID, :type]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      branch: {:union, [:string, :null]},
      directory: {:union, [:string, :null]},
      extra: {:union, [:map, :null]},
      id: :string,
      name: {:union, [:string, :null]},
      projectID: :string,
      type: :string
    ]
  end
end

defmodule HiveServerElixir.Opencode.Generated.EventTodoUpdatedProperties do
  @moduledoc """
  Provides struct and type for a EventTodoUpdatedProperties
  """

  @type t :: %__MODULE__{
          sessionID: String.t(),
          todos: [HiveServerElixir.Opencode.Generated.Todo.t()]
        }

  defstruct [:sessionID, :todos]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [sessionID: :string, todos: [{HiveServerElixir.Opencode.Generated.Todo, :t}]]
  end
end

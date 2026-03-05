defmodule HiveServerElixir.Opencode.Generated.Project do
  @moduledoc """
  Provides struct and type for a Project
  """

  @type t :: %__MODULE__{
          commands: HiveServerElixir.Opencode.Generated.ProjectCommands.t() | nil,
          icon: HiveServerElixir.Opencode.Generated.ProjectIcon.t() | nil,
          id: String.t(),
          name: String.t() | nil,
          sandboxes: [String.t()],
          time: HiveServerElixir.Opencode.Generated.ProjectTime.t(),
          vcs: String.t() | nil,
          worktree: String.t()
        }

  defstruct [:commands, :icon, :id, :name, :sandboxes, :time, :vcs, :worktree]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      commands: {HiveServerElixir.Opencode.Generated.ProjectCommands, :t},
      icon: {HiveServerElixir.Opencode.Generated.ProjectIcon, :t},
      id: :string,
      name: :string,
      sandboxes: [:string],
      time: {HiveServerElixir.Opencode.Generated.ProjectTime, :t},
      vcs: {:const, "git"},
      worktree: :string
    ]
  end
end

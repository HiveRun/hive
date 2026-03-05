defmodule HiveServerElixir.Opencode.Generated.GlobalSession do
  @moduledoc """
  Provides struct and type for a GlobalSession
  """

  @type t :: %__MODULE__{
          directory: String.t(),
          id: String.t(),
          parentID: String.t() | nil,
          permission: [HiveServerElixir.Opencode.Generated.PermissionRule.t()] | nil,
          project: HiveServerElixir.Opencode.Generated.ProjectSummary.t() | nil,
          projectID: String.t(),
          revert: HiveServerElixir.Opencode.Generated.GlobalSessionRevert.t() | nil,
          share: HiveServerElixir.Opencode.Generated.GlobalSessionShare.t() | nil,
          slug: String.t(),
          summary: HiveServerElixir.Opencode.Generated.GlobalSessionSummary.t() | nil,
          time: HiveServerElixir.Opencode.Generated.GlobalSessionTime.t(),
          title: String.t(),
          version: String.t(),
          workspaceID: String.t() | nil
        }

  defstruct [
    :directory,
    :id,
    :parentID,
    :permission,
    :project,
    :projectID,
    :revert,
    :share,
    :slug,
    :summary,
    :time,
    :title,
    :version,
    :workspaceID
  ]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      directory: :string,
      id: :string,
      parentID: :string,
      permission: [{HiveServerElixir.Opencode.Generated.PermissionRule, :t}],
      project: {:union, [{HiveServerElixir.Opencode.Generated.ProjectSummary, :t}, :null]},
      projectID: :string,
      revert: {HiveServerElixir.Opencode.Generated.GlobalSessionRevert, :t},
      share: {HiveServerElixir.Opencode.Generated.GlobalSessionShare, :t},
      slug: :string,
      summary: {HiveServerElixir.Opencode.Generated.GlobalSessionSummary, :t},
      time: {HiveServerElixir.Opencode.Generated.GlobalSessionTime, :t},
      title: :string,
      version: :string,
      workspaceID: :string
    ]
  end
end

defmodule HiveServerElixir.Opencode.Generated.Session do
  @moduledoc """
  Provides API endpoints related to session
  """

  @default_client HiveServerElixir.Opencode.Client

  @doc """
  Get session children

  Retrieve all child sessions that were forked from the specified parent session.

  ## Options

    * `directory`
    * `workspace`

  """
  @spec session_children(sessionID :: String.t(), opts :: keyword) ::
          {:ok, [HiveServerElixir.Opencode.Generated.Session.t()]}
          | {:error,
             HiveServerElixir.Opencode.Generated.BadRequestError.t()
             | HiveServerElixir.Opencode.Generated.NotFoundError.t()}
  def session_children(sessionID, opts \\ []) do
    client = opts[:client] || @default_client
    query = Keyword.take(opts, [:directory, :workspace])

    client.request(%{
      args: [sessionID: sessionID],
      call: {HiveServerElixir.Opencode.Generated.Session, :session_children},
      url: "/session/#{sessionID}/children",
      method: :get,
      query: query,
      response: [
        {200, [{HiveServerElixir.Opencode.Generated.Session, :t}]},
        {400, {HiveServerElixir.Opencode.Generated.BadRequestError, :t}},
        {404, {HiveServerElixir.Opencode.Generated.NotFoundError, :t}}
      ],
      opts: opts
    })
  end

  @doc """
  Get session

  Retrieve detailed information about a specific OpenCode session.

  ## Options

    * `directory`
    * `workspace`

  """
  @spec session_get(sessionID :: String.t(), opts :: keyword) ::
          {:ok, HiveServerElixir.Opencode.Generated.Session.t()}
          | {:error,
             HiveServerElixir.Opencode.Generated.BadRequestError.t()
             | HiveServerElixir.Opencode.Generated.NotFoundError.t()}
  def session_get(sessionID, opts \\ []) do
    client = opts[:client] || @default_client
    query = Keyword.take(opts, [:directory, :workspace])

    client.request(%{
      args: [sessionID: sessionID],
      call: {HiveServerElixir.Opencode.Generated.Session, :session_get},
      url: "/session/#{sessionID}",
      method: :get,
      query: query,
      response: [
        {200, {HiveServerElixir.Opencode.Generated.Session, :t}},
        {400, {HiveServerElixir.Opencode.Generated.BadRequestError, :t}},
        {404, {HiveServerElixir.Opencode.Generated.NotFoundError, :t}}
      ],
      opts: opts
    })
  end

  @type t :: %__MODULE__{
          directory: String.t(),
          id: String.t(),
          parentID: String.t() | nil,
          permission: [HiveServerElixir.Opencode.Generated.PermissionRule.t()] | nil,
          projectID: String.t(),
          revert: HiveServerElixir.Opencode.Generated.SessionRevert.t() | nil,
          share: HiveServerElixir.Opencode.Generated.SessionShare.t() | nil,
          slug: String.t(),
          summary: HiveServerElixir.Opencode.Generated.SessionSummary.t() | nil,
          time: HiveServerElixir.Opencode.Generated.SessionTime.t(),
          title: String.t(),
          version: String.t(),
          workspaceID: String.t() | nil
        }

  defstruct [
    :directory,
    :id,
    :parentID,
    :permission,
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
      projectID: :string,
      revert: {HiveServerElixir.Opencode.Generated.SessionRevert, :t},
      share: {HiveServerElixir.Opencode.Generated.SessionShare, :t},
      slug: :string,
      summary: {HiveServerElixir.Opencode.Generated.SessionSummary, :t},
      time: {HiveServerElixir.Opencode.Generated.SessionTime, :t},
      title: :string,
      version: :string,
      workspaceID: :string
    ]
  end
end

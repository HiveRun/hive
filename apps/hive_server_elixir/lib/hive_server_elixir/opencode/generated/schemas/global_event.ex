defmodule HiveServerElixir.Opencode.Generated.GlobalEvent do
  @moduledoc """
  Provides struct and type for a GlobalEvent
  """

  @type t :: %__MODULE__{
          directory: String.t(),
          payload:
            HiveServerElixir.Opencode.Generated.EventCommandExecuted.t()
            | HiveServerElixir.Opencode.Generated.EventFileEdited.t()
            | HiveServerElixir.Opencode.Generated.EventFileWatcherUpdated.t()
            | HiveServerElixir.Opencode.Generated.EventGlobalDisposed.t()
            | HiveServerElixir.Opencode.Generated.EventInstallationUpdateAvailable.t()
            | HiveServerElixir.Opencode.Generated.EventInstallationUpdated.t()
            | HiveServerElixir.Opencode.Generated.EventLspClientDiagnostics.t()
            | HiveServerElixir.Opencode.Generated.EventLspUpdated.t()
            | HiveServerElixir.Opencode.Generated.EventMcpBrowserOpenFailed.t()
            | HiveServerElixir.Opencode.Generated.EventMcpToolsChanged.t()
            | HiveServerElixir.Opencode.Generated.EventMessagePartDelta.t()
            | HiveServerElixir.Opencode.Generated.EventMessagePartRemoved.t()
            | HiveServerElixir.Opencode.Generated.EventMessagePartUpdated.t()
            | HiveServerElixir.Opencode.Generated.EventMessageRemoved.t()
            | HiveServerElixir.Opencode.Generated.EventMessageUpdated.t()
            | HiveServerElixir.Opencode.Generated.EventPermissionAsked.t()
            | HiveServerElixir.Opencode.Generated.EventPermissionReplied.t()
            | HiveServerElixir.Opencode.Generated.EventProjectUpdated.t()
            | HiveServerElixir.Opencode.Generated.EventPtyCreated.t()
            | HiveServerElixir.Opencode.Generated.EventPtyDeleted.t()
            | HiveServerElixir.Opencode.Generated.EventPtyExited.t()
            | HiveServerElixir.Opencode.Generated.EventPtyUpdated.t()
            | HiveServerElixir.Opencode.Generated.EventQuestionAsked.t()
            | HiveServerElixir.Opencode.Generated.EventQuestionRejected.t()
            | HiveServerElixir.Opencode.Generated.EventQuestionReplied.t()
            | HiveServerElixir.Opencode.Generated.EventServerConnected.t()
            | HiveServerElixir.Opencode.Generated.EventServerInstanceDisposed.t()
            | HiveServerElixir.Opencode.Generated.EventSessionCompacted.t()
            | HiveServerElixir.Opencode.Generated.EventSessionCreated.t()
            | HiveServerElixir.Opencode.Generated.EventSessionDeleted.t()
            | HiveServerElixir.Opencode.Generated.EventSessionDiff.t()
            | HiveServerElixir.Opencode.Generated.EventSessionError.t()
            | HiveServerElixir.Opencode.Generated.EventSessionIdle.t()
            | HiveServerElixir.Opencode.Generated.EventSessionStatus.t()
            | HiveServerElixir.Opencode.Generated.EventSessionUpdated.t()
            | HiveServerElixir.Opencode.Generated.EventTodoUpdated.t()
            | HiveServerElixir.Opencode.Generated.EventTuiCommandExecute.t()
            | HiveServerElixir.Opencode.Generated.EventTuiPromptAppend.t()
            | HiveServerElixir.Opencode.Generated.EventTuiSessionSelect.t()
            | HiveServerElixir.Opencode.Generated.EventTuiToastShow.t()
            | HiveServerElixir.Opencode.Generated.EventVcsBranchUpdated.t()
            | HiveServerElixir.Opencode.Generated.EventWorkspaceFailed.t()
            | HiveServerElixir.Opencode.Generated.EventWorkspaceReady.t()
            | HiveServerElixir.Opencode.Generated.EventWorktreeFailed.t()
            | HiveServerElixir.Opencode.Generated.EventWorktreeReady.t()
        }

  defstruct [:directory, :payload]

  @doc false
  @spec __fields__(atom) :: keyword
  def __fields__(type \\ :t)

  def __fields__(:t) do
    [
      directory: :string,
      payload:
        {:union,
         [
           {HiveServerElixir.Opencode.Generated.EventCommandExecuted, :t},
           {HiveServerElixir.Opencode.Generated.EventFileEdited, :t},
           {HiveServerElixir.Opencode.Generated.EventFileWatcherUpdated, :t},
           {HiveServerElixir.Opencode.Generated.EventGlobalDisposed, :t},
           {HiveServerElixir.Opencode.Generated.EventInstallationUpdateAvailable, :t},
           {HiveServerElixir.Opencode.Generated.EventInstallationUpdated, :t},
           {HiveServerElixir.Opencode.Generated.EventLspClientDiagnostics, :t},
           {HiveServerElixir.Opencode.Generated.EventLspUpdated, :t},
           {HiveServerElixir.Opencode.Generated.EventMcpBrowserOpenFailed, :t},
           {HiveServerElixir.Opencode.Generated.EventMcpToolsChanged, :t},
           {HiveServerElixir.Opencode.Generated.EventMessagePartDelta, :t},
           {HiveServerElixir.Opencode.Generated.EventMessagePartRemoved, :t},
           {HiveServerElixir.Opencode.Generated.EventMessagePartUpdated, :t},
           {HiveServerElixir.Opencode.Generated.EventMessageRemoved, :t},
           {HiveServerElixir.Opencode.Generated.EventMessageUpdated, :t},
           {HiveServerElixir.Opencode.Generated.EventPermissionAsked, :t},
           {HiveServerElixir.Opencode.Generated.EventPermissionReplied, :t},
           {HiveServerElixir.Opencode.Generated.EventProjectUpdated, :t},
           {HiveServerElixir.Opencode.Generated.EventPtyCreated, :t},
           {HiveServerElixir.Opencode.Generated.EventPtyDeleted, :t},
           {HiveServerElixir.Opencode.Generated.EventPtyExited, :t},
           {HiveServerElixir.Opencode.Generated.EventPtyUpdated, :t},
           {HiveServerElixir.Opencode.Generated.EventQuestionAsked, :t},
           {HiveServerElixir.Opencode.Generated.EventQuestionRejected, :t},
           {HiveServerElixir.Opencode.Generated.EventQuestionReplied, :t},
           {HiveServerElixir.Opencode.Generated.EventServerConnected, :t},
           {HiveServerElixir.Opencode.Generated.EventServerInstanceDisposed, :t},
           {HiveServerElixir.Opencode.Generated.EventSessionCompacted, :t},
           {HiveServerElixir.Opencode.Generated.EventSessionCreated, :t},
           {HiveServerElixir.Opencode.Generated.EventSessionDeleted, :t},
           {HiveServerElixir.Opencode.Generated.EventSessionDiff, :t},
           {HiveServerElixir.Opencode.Generated.EventSessionError, :t},
           {HiveServerElixir.Opencode.Generated.EventSessionIdle, :t},
           {HiveServerElixir.Opencode.Generated.EventSessionStatus, :t},
           {HiveServerElixir.Opencode.Generated.EventSessionUpdated, :t},
           {HiveServerElixir.Opencode.Generated.EventTodoUpdated, :t},
           {HiveServerElixir.Opencode.Generated.EventTuiCommandExecute, :t},
           {HiveServerElixir.Opencode.Generated.EventTuiPromptAppend, :t},
           {HiveServerElixir.Opencode.Generated.EventTuiSessionSelect, :t},
           {HiveServerElixir.Opencode.Generated.EventTuiToastShow, :t},
           {HiveServerElixir.Opencode.Generated.EventVcsBranchUpdated, :t},
           {HiveServerElixir.Opencode.Generated.EventWorkspaceFailed, :t},
           {HiveServerElixir.Opencode.Generated.EventWorkspaceReady, :t},
           {HiveServerElixir.Opencode.Generated.EventWorktreeFailed, :t},
           {HiveServerElixir.Opencode.Generated.EventWorktreeReady, :t}
         ]}
    ]
  end
end

# Agent Chat UX

- **Simple transcript**: Chronological stream of user and agent messages—no special tooling visualization yet. Focus on reliable text display first. Messages must remain selectable for copy/paste.
- **Stable scrolling**: Preserve scroll position when messages send/arrive and across refresh/navigation. Display a down-arrow indicator whenever the user is not at the bottom—even with no new messages—so they can jump back to the latest on demand.
- **Message states**: Highlight aborted/failed messages with a subtle status tag and muted styling so users can see where the agent stopped. Successful messages stay visually consistent.
- **Persistent composer**: Keep the input contents intact across refresh/navigation. Provide an explicit “Clear input” action so the user controls when drafts are discarded.
- **Sending shortcut**: Require `⌘ + Enter` / `Ctrl + Enter` to send. Plain `Enter` inserts a newline; indicate the shortcut directly in the UI and keep focus in the composer after sending.
- **Interruptions**: Expose an Abort button and bind `Esc` to the same action so the user can cancel the agent quickly without losing draft text or scroll position. After a restart, show a “Resume agent” banner prompting the user to rehydrate context before sending new input.
- **Canned replies**: Allow user-defined quick responses (chips/buttons) that insert preset text into the composer without auto-sending. Provide a simple manage/edit affordance (e.g., overflow menu linking to settings) so users can update canned text without leaving the construct.
- **Layout basics**: Keep transcript and composer in the main column with any context/service panels in a secondary column that collapses into tabs on smaller screens. Ensure the down-arrow indicator and canned responses adapt in responsive layouts.

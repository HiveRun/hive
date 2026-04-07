defmodule HiveServerElixir.Cells.Terminals.SessionSpec do
  @moduledoc false

  @enforce_keys [:scope, :kind, :command, :args, :cwd, :buffer_kind, :fingerprint]
  defstruct [
    :scope,
    :kind,
    :command,
    :args,
    :cwd,
    :buffer_kind,
    :fingerprint,
    :allow_control_input,
    :plan_mode,
    :session_prefix,
    cols: 120,
    rows: 36
  ]

  @type t :: %__MODULE__{
          scope: term(),
          kind: :terminal | :setup | :service | :chat,
          command: String.t(),
          args: [String.t()],
          cwd: String.t(),
          buffer_kind: :default | :chat,
          fingerprint: String.t(),
          allow_control_input: boolean(),
          plan_mode: boolean(),
          session_prefix: String.t(),
          cols: pos_integer(),
          rows: pos_integer()
        }
end

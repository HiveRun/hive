defmodule HiveServerElixir.Cells.TerminalSessionKind do
  @moduledoc false

  use Ash.Type.Enum,
    values: [:terminal, :setup, :service, :chat]
end

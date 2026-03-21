defmodule HiveServerElixir.Cells.TerminalSessionKind do
  @moduledoc false

  use Ash.Type.Enum,
    values: [:setup, :service, :chat]
end

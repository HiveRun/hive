defmodule HiveServerElixir.Cells.TerminalSessionStatus do
  @moduledoc false

  use Ash.Type.Enum,
    values: [:running, :closed]
end

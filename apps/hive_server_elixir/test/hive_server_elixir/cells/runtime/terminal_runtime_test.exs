defmodule HiveServerElixir.Cells.TerminalRuntimeTest do
  use HiveServerElixir.DataCase, async: false

  alias HiveServerElixir.Cells.TerminalRuntime

  test "caps retained terminal history while keeping newest chunks in order" do
    cell_id = Ash.UUID.generate()

    for index <- 1..1_050 do
      :ok = TerminalRuntime.append_setup_output(cell_id, "line-#{index}\n")
    end

    output = TerminalRuntime.read_setup_output(cell_id)

    assert length(output) == 1_000
    assert hd(output) == "line-51\n"
    assert List.last(output) == "line-1050\n"

    :ok = TerminalRuntime.clear_cell(cell_id)
  end
end

defmodule HiveServerElixir.Cells.Terminals.Buffer do
  @moduledoc false

  @chat_limit 2_000_000
  @chat_retain 1_600_000
  @default_limit 250_000
  @terminal_reset_sequence "\x1bc"

  @spec empty(atom()) :: String.t()
  def empty(_kind), do: ""

  @spec append(String.t(), String.t(), atom()) :: String.t()
  def append(current, chunk, :chat) when is_binary(current) and is_binary(chunk) do
    next = current <> chunk

    if byte_size(next) <= @chat_limit do
      next
    else
      retain_start = max(byte_size(next) - @chat_retain, 0)
      slice = slice_part(next, retain_start, byte_size(next) - retain_start)

      trimmed =
        case :binary.match(slice, "\n") do
          {newline_index, 1} ->
            slice_part(slice, newline_index + 1, byte_size(slice) - newline_index - 1)

          :nomatch ->
            slice
        end

      @terminal_reset_sequence <> trimmed
    end
  end

  def append(current, chunk, _kind) when is_binary(current) and is_binary(chunk) do
    next = current <> chunk

    if byte_size(next) <= @default_limit do
      next
    else
      slice_part(next, byte_size(next) - @default_limit, @default_limit)
    end
  end

  defp slice_part(_value, _start, length) when length <= 0, do: ""
  defp slice_part(value, start, length), do: :binary.part(value, start, length)
end

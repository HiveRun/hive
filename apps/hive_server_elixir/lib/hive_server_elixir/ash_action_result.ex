defmodule HiveServerElixir.AshActionResult do
  @moduledoc false

  @spec normalize({:ok, term()} | {:error, term()} | term()) ::
          {:ok, term()} | {:error, term()} | term()
  def normalize({:ok, payload}), do: {:ok, payload}

  def normalize({:error, %Ash.Error.Unknown{errors: errors} = error}) do
    case Enum.find_value(errors, &extract_known_error/1) do
      nil -> {:error, error}
      known_error -> {:error, known_error}
    end
  end

  def normalize(other), do: other

  defp extract_known_error(%{value: value}) when is_list(value) do
    case value do
      [{status, message}] when status in [:bad_request, :not_found] and is_binary(message) ->
        {status, message}

      _other ->
        nil
    end
  end

  defp extract_known_error(_error), do: nil
end

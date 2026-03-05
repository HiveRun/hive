defmodule HiveServerElixir.Opencode.Adapter do
  @moduledoc """
  Thin OpenCode adapter that wraps generated operations with normalized errors.
  """

  alias HiveServerElixir.Opencode.Generated.Operations

  @type normalized_error :: %{
          type: :http_error | :transport_error | :unknown_error,
          status: integer | nil,
          message: String.t(),
          details: term
        }

  @spec health(keyword) :: {:ok, map} | {:error, normalized_error}
  def health(opts \\ []) do
    operations_module = Keyword.get(opts, :operations_module, Operations)
    operation_opts = Keyword.delete(opts, :operations_module)

    case operations_module.global_health(operation_opts) do
      {:ok, response} -> {:ok, response}
      {:error, reason} -> {:error, normalize_error(reason)}
      :error -> {:error, normalize_error(:unknown)}
    end
  end

  @spec next_global_event(keyword) :: {:ok, map} | {:error, normalized_error}
  def next_global_event(opts \\ []) do
    operations_module = Keyword.get(opts, :operations_module, Operations)
    operation_opts = Keyword.delete(opts, :operations_module)

    case operations_module.global_event(operation_opts) do
      {:ok, response} -> {:ok, response}
      {:error, reason} -> {:error, normalize_error(reason)}
      :error -> {:error, normalize_error(:unknown)}
    end
  end

  defp normalize_error(%{status: status, body: body}) when is_integer(status) do
    %{
      type: :http_error,
      status: status,
      message: extract_message(body, "HTTP #{status} response from OpenCode"),
      details: body
    }
  end

  defp normalize_error(%{type: :transport, reason: reason}) do
    %{
      type: :transport_error,
      status: nil,
      message: "OpenCode request failed before receiving a response",
      details: reason
    }
  end

  defp normalize_error(reason) do
    %{
      type: :unknown_error,
      status: nil,
      message: "OpenCode request failed with an unexpected error",
      details: reason
    }
  end

  defp extract_message(%{"message" => message}, _fallback) when is_binary(message), do: message
  defp extract_message(%{message: message}, _fallback) when is_binary(message), do: message
  defp extract_message(_body, fallback), do: fallback
end

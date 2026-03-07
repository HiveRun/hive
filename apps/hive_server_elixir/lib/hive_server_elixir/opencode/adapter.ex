defmodule HiveServerElixir.Opencode.Adapter do
  @moduledoc """
  Thin OpenCode adapter that wraps generated operations with normalized errors.
  """

  alias HiveServerElixir.Opencode.AgentEventLog
  alias HiveServerElixir.Opencode.Generated.Operations

  @type normalized_error :: %{
          type: :http_error | :transport_error | :unknown_error | :persistence_error,
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

    persist_context = Keyword.get(opts, :persist_context)

    persist_global_event =
      Keyword.get(opts, :persist_global_event, &AgentEventLog.append_global_event/2)

    operation_opts =
      opts
      |> Keyword.delete(:operations_module)
      |> Keyword.delete(:persist_context)
      |> Keyword.delete(:persist_global_event)

    case operations_module.global_event(operation_opts) do
      {:ok, response} ->
        case persist_global_event(response, persist_context, persist_global_event) do
          :ok -> {:ok, response}
          {:error, reason} -> {:error, normalize_persistence_error(reason)}
        end

      {:error, reason} ->
        {:error, normalize_error(reason)}

      :error ->
        {:error, normalize_error(:unknown)}
    end
  end

  defp persist_global_event(_global_event, nil, _persist_global_event), do: :ok

  defp persist_global_event(global_event, persist_context, persist_global_event)
       when is_map(persist_context) and is_function(persist_global_event, 2) do
    case persist_global_event.(global_event, persist_context) do
      {:ok, _entry} -> :ok
      :ok -> :ok
      {:error, reason} -> {:error, reason}
      other -> {:error, other}
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

  defp normalize_persistence_error(reason) do
    %{
      type: :persistence_error,
      status: nil,
      message: "OpenCode event persistence failed",
      details: reason
    }
  end

  defp extract_message(%{"message" => message}, _fallback) when is_binary(message), do: message
  defp extract_message(%{message: message}, _fallback) when is_binary(message), do: message
  defp extract_message(_body, fallback), do: fallback
end

defmodule HiveServerElixir.Opencode.Adapter do
  @moduledoc """
  Thin OpenCode adapter that normalizes SDK responses for Hive runtime code.
  """

  alias OpenCode.Generated.Operations

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

  @spec global_event_stream(keyword) :: {:ok, Enumerable.t()}
  def global_event_stream(opts \\ []) do
    case Keyword.fetch(opts, :global_event) do
      {:ok, callback} when is_function(callback, 1) ->
        {:ok, stream_from_callback(callback, opts)}

      _error ->
        {:ok, req_sse_stream(opts)}
    end
  end

  @spec normalize_error(term()) :: normalized_error()
  def normalize_error({status, body}) when is_integer(status) do
    %{
      type: :http_error,
      status: status,
      message: extract_message(body, "HTTP #{status} response from OpenCode"),
      details: body
    }
  end

  def normalize_error(%{status: status, body: body}) when is_integer(status) do
    %{
      type: :http_error,
      status: status,
      message: extract_message(body, "HTTP #{status} response from OpenCode"),
      details: body
    }
  end

  def normalize_error(%Req.TransportError{} = reason) do
    %{
      type: :transport_error,
      status: nil,
      message: "OpenCode request failed before receiving a response",
      details: reason
    }
  end

  def normalize_error(%{type: :transport, reason: reason}) do
    %{
      type: :transport_error,
      status: nil,
      message: "OpenCode request failed before receiving a response",
      details: reason
    }
  end

  def normalize_error(reason) do
    %{
      type: :unknown_error,
      status: nil,
      message: "OpenCode request failed with an unexpected error",
      details: reason
    }
  end

  @spec normalize_persistence_error(term()) :: normalized_error()
  def normalize_persistence_error(reason) do
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

  defp stream_from_callback(callback, opts) do
    Stream.resource(
      fn -> %{done?: false, callback: callback, opts: opts} end,
      fn
        %{done?: true} = state ->
          {:halt, state}

        %{callback: callback, opts: callback_opts} = state ->
          case callback.(callback_opts) do
            {:ok, payload} -> {[payload], %{state | done?: true}}
            {:error, reason} -> {[{:error, normalize_error(reason)}], %{state | done?: true}}
            :error -> {[{:error, normalize_error(:unknown)}], %{state | done?: true}}
          end
      end,
      fn _state -> :ok end
    )
  end

  defp req_sse_stream(opts) do
    req =
      Req.new(
        url: resolve_base_url(opts) <> "/global/event",
        method: :get,
        receive_timeout: Keyword.get(opts, :timeout, :infinity),
        retry: Keyword.get(opts, :retry, false)
      )
      |> add_headers(Keyword.get(opts, :headers, []))
      |> add_directory(Keyword.get(opts, :directory))
      |> Req.Request.put_header("accept", "text/event-stream")
      |> Req.merge(Keyword.get(opts, :req_options, []))

    Stream.resource(
      fn ->
        ref = make_ref()
        parent = self()
        pid = spawn_link(fn -> sse_run(req, parent, ref) end)
        %{ref: ref, pid: pid, buffer: ""}
      end,
      fn state ->
        receive do
          {ref, :data, data} when ref == state.ref ->
            {events, buffer} = parse_sse(state.buffer <> data)
            {events, %{state | buffer: buffer}}

          {ref, :http_error, status} when ref == state.ref ->
            body = decode_error_body(state.buffer)
            {[{:error, normalize_error({status, body})}], %{state | buffer: ""}}

          {ref, :done} when ref == state.ref ->
            {:halt, state}

          {ref, :error, error} when ref == state.ref ->
            {[{:error, normalize_error(error)}], %{state | buffer: ""}}
        end
      end,
      fn state ->
        if Process.alive?(state.pid) do
          Process.exit(state.pid, :normal)
        end
      end
    )
  end

  defp sse_run(req, pid, ref) do
    case Req.request(req,
           into: fn {:data, data}, acc ->
             send(pid, {ref, :data, data})
             {:cont, acc}
           end
         ) do
      {:ok, %Req.Response{status: status}} when status in 200..299 ->
        send(pid, {ref, :done})

      {:ok, %Req.Response{status: status}} ->
        send(pid, {ref, :http_error, status})

      {:error, error} ->
        send(pid, {ref, :error, error})
    end
  end

  defp parse_sse(data) do
    parts = String.split(data, "\n\n")

    case parts do
      [_single] ->
        {[], data}

      _many ->
        events = parts |> Enum.drop(-1) |> Enum.flat_map(&decode_sse_chunk/1)
        {events, List.last(parts) || ""}
    end
  end

  defp decode_sse_chunk(chunk) do
    data =
      chunk
      |> String.split("\n")
      |> Enum.filter(&String.starts_with?(&1, "data:"))
      |> Enum.map(&String.replace_prefix(&1, "data:", ""))
      |> Enum.join("\n")
      |> String.trim()

    case data do
      "" ->
        []

      value ->
        case Jason.decode(value) do
          {:ok, decoded} -> [decoded]
          {:error, _reason} -> [value]
        end
    end
  end

  defp decode_error_body(""), do: ""

  defp decode_error_body(value) do
    case Jason.decode(value) do
      {:ok, body} -> body
      {:error, _reason} -> value
    end
  end

  defp add_headers(req, []), do: req

  defp add_headers(req, headers) when is_map(headers),
    do: Enum.reduce(headers, req, &put_header/2)

  defp add_headers(req, headers), do: Enum.reduce(headers, req, &put_header/2)

  defp put_header({key, value}, req) do
    Req.Request.put_header(req, to_string(key), to_string(value))
  end

  defp add_directory(req, nil), do: req
  defp add_directory(req, ""), do: req

  defp add_directory(req, directory) do
    Req.Request.put_header(req, "x-opencode-directory", directory_header(directory))
  end

  defp directory_header(directory) do
    if String.match?(directory, ~r/[^\x00-\x7F]/) do
      URI.encode(directory)
    else
      directory
    end
  end

  defp resolve_base_url(opts) do
    Keyword.get(opts, :base_url) ||
      System.get_env("HIVE_OPENCODE_BASE_URL") ||
      Application.get_env(:hive_server_elixir, :opencode_base_url) ||
      managed_base_url()
  end

  defp managed_base_url do
    case Process.whereis(HiveServerElixir.Opencode.ServerManager) do
      pid when is_pid(pid) -> HiveServerElixir.Opencode.ServerManager.base_url()
      _other -> "http://localhost:4096"
    end
  end
end

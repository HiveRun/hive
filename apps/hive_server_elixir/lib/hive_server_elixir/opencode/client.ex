defmodule HiveServerElixir.Opencode.Client do
  @moduledoc """
  HTTP transport for generated OpenCode operations.
  """

  @default_base_url "http://localhost:4096"
  @default_timeout 30_000

  @type operation :: %{
          required(:method) => atom,
          required(:url) => String.t(),
          optional(:body) => term,
          optional(:query) => keyword,
          optional(:request) => list,
          optional(:response) => list,
          optional(:opts) => keyword
        }

  @spec request(operation) :: {:ok, term} | {:error, term} | :error
  def request(operation) do
    opts = Map.get(operation, :opts, [])

    request_opts =
      [
        base_url:
          Keyword.get(
            opts,
            :base_url,
            Application.get_env(:hive_server_elixir, :opencode_base_url, @default_base_url)
          ),
        method: Map.fetch!(operation, :method),
        url: Map.fetch!(operation, :url),
        params: Map.get(operation, :query, []),
        headers: Keyword.get(opts, :headers, []),
        retry: Keyword.get(opts, :retry, false),
        receive_timeout: Keyword.get(opts, :timeout, @default_timeout)
      ]
      |> maybe_put_auth(opts)
      |> maybe_put_body(operation)
      |> Keyword.merge(Keyword.get(opts, :req_options, []))

    case Req.request(request_opts) do
      {:ok, %Req.Response{status: status, body: body}} ->
        classify_response(status, body, Map.get(operation, :response, []))

      {:error, reason} ->
        {:error, %{type: :transport, reason: reason}}
    end
  end

  defp maybe_put_auth(request_opts, opts) do
    case Keyword.get(opts, :token) do
      nil -> request_opts
      token -> Keyword.put(request_opts, :auth, {:bearer, token})
    end
  end

  defp maybe_put_body(request_opts, operation) do
    case Map.get(operation, :body) do
      nil ->
        request_opts

      body ->
        if json_request?(operation) do
          Keyword.put(request_opts, :json, body)
        else
          Keyword.put(request_opts, :body, body)
        end
    end
  end

  defp json_request?(operation) do
    operation
    |> Map.get(:request, [])
    |> Enum.any?(fn
      {"application/json", _} -> true
      _ -> false
    end)
  end

  defp classify_response(status, body, response_specs) do
    case Enum.find(response_specs, fn {response_status, _schema} -> response_status == status end) do
      {response_status, _schema} when response_status >= 200 and response_status < 300 ->
        {:ok, body}

      {_, _schema} ->
        {:error, %{status: status, body: body}}

      nil when status >= 200 and status < 300 ->
        {:ok, body}

      nil ->
        :error
    end
  end
end

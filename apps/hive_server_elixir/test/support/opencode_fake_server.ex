defmodule HiveServerElixir.OpencodeFakeServer do
  @moduledoc false

  import Plug.Conn

  @behaviour Plug

  @type response :: {:ok, term()} | {:error, %{status: integer(), body: term()}}

  @spec setup_open_code_stub(keyword()) :: map()
  def setup_open_code_stub(opts \\ []) do
    {:ok, state_pid} = Agent.start_link(fn -> initial_state(opts) end)
    port = reserve_port()

    {:ok, server_pid} =
      Bandit.start_link(
        plug: {__MODULE__, state_pid},
        scheme: :http,
        ip: {127, 0, 0, 1},
        port: port
      )

    base_url = Keyword.get(opts, :base_url, "http://127.0.0.1:#{port}")

    %{
      state_pid: state_pid,
      server_pid: server_pid,
      base_url: base_url,
      client_opts: [base_url: base_url],
      adapter_opts: [base_url: base_url]
    }
  end

  @impl Plug
  def init(state_pid), do: state_pid

  @impl Plug
  def call(conn, state_pid) do
    conn
    |> fetch_query_params()
    |> handle_request(state_pid)
  end

  @spec put_catalog(map() | pid(), response()) :: :ok
  def put_catalog(server, response), do: update(server, &Map.put(&1, :catalog, response))

  @spec put_session_messages(map() | pid(), String.t(), response()) :: :ok
  def put_session_messages(server, session_id, response) when is_binary(session_id) do
    update(server, fn state ->
      put_in(state, [:session_messages, session_id], response)
    end)
  end

  @spec put_health(map() | pid(), response()) :: :ok
  def put_health(server, response), do: update(server, &Map.put(&1, :health, response))

  @spec enqueue_global_event(map() | pid(), response()) :: :ok
  def enqueue_global_event(server, response) do
    update(server, fn state ->
      %{state | global_events: :queue.in(response, state.global_events)}
    end)
  end

  @spec requests(map() | pid()) :: [map()]
  def requests(server) do
    server
    |> state_pid()
    |> Agent.get(&Enum.reverse(&1.requests))
  end

  defp initial_state(opts) do
    %{
      catalog: Keyword.get(opts, :catalog, {:ok, default_catalog()}),
      session_messages: Keyword.get(opts, :session_messages, %{}),
      health: Keyword.get(opts, :health, {:ok, %{healthy: true, version: "test"}}),
      global_events: :queue.from_list(Keyword.get(opts, :global_events, [])),
      requests: []
    }
  end

  defp handle_request(conn, state_pid) do
    record_request(state_pid, conn)

    case {conn.method, conn.request_path} do
      {"GET", "/config/providers"} ->
        respond(conn, Agent.get(state_pid, & &1.catalog))

      {"GET", "/global/health"} ->
        respond(conn, Agent.get(state_pid, & &1.health))

      {"GET", "/global/event"} ->
        state_pid
        |> next_global_event()
        |> then(&respond_sse(conn, &1))

      {"GET", path} ->
        with ["", "session", session_id, "message"] <- String.split(path, "/", trim: false) do
          session_id
          |> session_messages_response(state_pid)
          |> then(&respond(conn, &1))
        else
          _ -> not_found(conn)
        end

      _other ->
        not_found(conn)
    end
  end

  defp session_messages_response(session_id, state_pid) do
    Agent.get(state_pid, fn state ->
      Map.get(
        state.session_messages,
        session_id,
        {:error, %{status: 404, body: %{message: "not found"}}}
      )
    end)
  end

  defp next_global_event(state_pid) do
    Agent.get_and_update(state_pid, fn state ->
      case :queue.out(state.global_events) do
        {{:value, response}, queue} ->
          {response, %{state | global_events: queue}}

        {:empty, queue} ->
          {{:error, %{status: 503, body: %{message: "no queued event"}}},
           %{state | global_events: queue}}
      end
    end)
  end

  defp respond(conn, {:ok, body}) do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(200, Jason.encode!(body))
  end

  defp respond(conn, {:error, %{status: status, body: body}}) do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(status, Jason.encode!(body))
  end

  defp respond_sse(conn, {:ok, body}) do
    conn
    |> put_resp_content_type("text/event-stream")
    |> send_resp(200, "data: #{Jason.encode!(body)}\n\n")
  end

  defp respond_sse(conn, {:error, %{status: status, body: body}}) do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(status, Jason.encode!(body))
  end

  defp not_found(conn) do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(404, Jason.encode!(%{message: "not found"}))
  end

  defp record_request(state_pid, conn) do
    request = %{
      method: conn.method,
      path: conn.request_path,
      params: conn.query_params,
      headers: Enum.into(conn.req_headers, %{})
    }

    try do
      Agent.update(state_pid, fn state ->
        %{state | requests: [request | state.requests]}
      end)
    catch
      :exit, _reason -> :ok
    end
  end

  defp update(server, fun) when is_function(fun, 1) do
    Agent.update(state_pid(server), fun)
  end

  defp state_pid(%{state_pid: state_pid}), do: state_pid
  defp state_pid(state_pid) when is_pid(state_pid), do: state_pid

  defp reserve_port do
    {:ok, socket} = :gen_tcp.listen(0, [:binary, active: false, ip: {127, 0, 0, 1}])
    {:ok, {_address, port}} = :inet.sockname(socket)
    :ok = :gen_tcp.close(socket)
    port
  end

  defp default_catalog do
    %{
      "default" => %{"opencode" => "big-pickle"},
      "providers" => [
        %{
          "id" => "opencode",
          "name" => "OpenCode",
          "models" => %{
            "big-pickle" => %{"id" => "big-pickle", "name" => "Big Pickle"}
          }
        }
      ]
    }
  end
end

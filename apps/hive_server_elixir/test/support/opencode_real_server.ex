defmodule HiveServerElixir.OpencodeRealServer do
  @moduledoc false

  alias OpenCode.Generated.Operations

  @startup_timeout_ms 15_000

  def start!(_workspace_path \\ nil) do
    case OpenCode.create_server(
           hostname: "127.0.0.1",
           port: reserve_port(),
           timeout: @startup_timeout_ms
         ) do
      {:ok, server} -> server
      {:error, reason} -> raise "failed to start real opencode server: #{inspect(reason)}"
    end
  end

  def stop(server) do
    OpenCode.close(%{server: server})
  rescue
    ArgumentError -> :ok
  end

  def client_opts(server, opts \\ []) do
    [base_url: server.url] ++ opts
  end

  def create_session!(server, workspace_path, title \\ "test-session") do
    client_opts = client_opts(server, directory: workspace_path)

    case Operations.session_create(%{title: title}, client_opts) do
      {:ok, session} -> session
      {:error, error} -> raise "failed to create OpenCode session: #{inspect(error)}"
    end
  end

  def prompt!(server, workspace_path, session_id, text) do
    client_opts = client_opts(server, directory: workspace_path, timeout: :infinity)

    body = %{
      model: %{providerID: "opencode", modelID: "big-pickle"},
      parts: [%{type: "text", text: text}]
    }

    case Operations.session_prompt(session_id, body, client_opts) do
      {:ok, response} -> response
      {:error, error} -> raise "failed to prompt OpenCode session: #{inspect(error)}"
    end
  end

  defp reserve_port do
    {:ok, socket} = :gen_tcp.listen(0, [:binary, active: false, ip: {127, 0, 0, 1}])
    {:ok, {_address, port}} = :inet.sockname(socket)
    :ok = :gen_tcp.close(socket)
    port
  end
end

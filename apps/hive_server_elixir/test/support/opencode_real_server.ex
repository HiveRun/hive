defmodule HiveServerElixir.OpencodeRealServer do
  @moduledoc false

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

  defp reserve_port do
    {:ok, socket} = :gen_tcp.listen(0, [:binary, active: false, ip: {127, 0, 0, 1}])
    {:ok, {_address, port}} = :inet.sockname(socket)
    :ok = :gen_tcp.close(socket)
    port
  end
end

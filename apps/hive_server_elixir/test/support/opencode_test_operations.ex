defmodule HiveServerElixir.Opencode.TestOperations do
  @moduledoc false

  @spec global_health(keyword) :: {:ok, term} | {:error, term} | :error
  def global_health(opts) do
    run_callback(opts, :global_health)
  end

  @spec global_event(keyword) :: {:ok, term} | {:error, term} | :error
  def global_event(opts) do
    run_callback(opts, :global_event)
  end

  defp run_callback(opts, callback_key) do
    callback = Keyword.fetch!(opts, callback_key)
    callback.(opts)
  end
end

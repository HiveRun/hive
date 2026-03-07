defmodule HiveServerElixir.Opencode.EventIngest do
  @moduledoc """
  Stream ingest entrypoint that pulls one OpenCode global event and persists it.
  """

  alias HiveServerElixir.Opencode.Adapter

  @spec ingest_next(map, keyword) :: {:ok, map} | {:error, Adapter.normalized_error()}
  def ingest_next(context, opts \\ []) when is_map(context) do
    opts
    |> Keyword.put(:persist_context, context)
    |> Adapter.next_global_event()
  end
end

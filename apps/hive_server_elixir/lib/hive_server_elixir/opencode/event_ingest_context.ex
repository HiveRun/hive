defmodule HiveServerElixir.Opencode.EventIngestContext do
  @moduledoc false

  @spec normalize(map()) :: map()
  def normalize(context) when is_map(context) do
    workspace_id = get(context, :workspace_id)
    cell_id = get(context, :cell_id)

    if workspace_id == nil or cell_id == nil do
      raise ArgumentError, "event ingest context requires workspace_id and cell_id"
    end

    %{
      workspace_id: workspace_id,
      cell_id: cell_id,
      session_id: get(context, :session_id),
      seq: get(context, :seq)
    }
  end

  @spec key(map()) :: {String.t(), String.t()}
  def key(context) when is_map(context) do
    normalized_context = normalize(context)
    {normalized_context.workspace_id, normalized_context.cell_id}
  end

  defp get(context, key) when is_atom(key) do
    Map.get(context, key) || Map.get(context, Atom.to_string(key))
  end
end

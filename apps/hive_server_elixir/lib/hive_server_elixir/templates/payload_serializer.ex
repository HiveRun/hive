defmodule HiveServerElixir.Templates.PayloadSerializer do
  @moduledoc false

  @spec list_payload(map()) :: map()
  def list_payload(payload) when is_map(payload) do
    %{templates: Enum.map(Map.get(payload, :templates, []), &template_payload/1)}
    |> maybe_put_defaults(Map.get(payload, :defaults))
    |> maybe_put_agent_defaults(Map.get(payload, :agent_defaults))
  end

  @spec template_payload(map()) :: map()
  def template_payload(payload) when is_map(payload) do
    %{
      id: Map.fetch!(payload, :id),
      label: Map.fetch!(payload, :label),
      type: Map.fetch!(payload, :type),
      configJson: Map.fetch!(payload, :config_json)
    }
    |> maybe_put_include_directories(Map.get(payload, :include_directories))
  end

  defp maybe_put_defaults(payload, nil), do: payload
  defp maybe_put_defaults(payload, defaults), do: Map.put(payload, :defaults, defaults)

  defp maybe_put_agent_defaults(payload, nil), do: payload

  defp maybe_put_agent_defaults(payload, defaults),
    do: Map.put(payload, :agentDefaults, camelize_map_keys(defaults))

  defp maybe_put_include_directories(payload, []), do: payload
  defp maybe_put_include_directories(payload, nil), do: payload

  defp maybe_put_include_directories(payload, include_directories),
    do: Map.put(payload, :includeDirectories, include_directories)

  defp camelize_map_keys(map) when is_map(map) do
    Enum.reduce(map, %{}, fn {key, value}, acc ->
      key_string = if is_atom(key), do: Atom.to_string(key), else: key
      Map.put(acc, key_string |> Macro.camelize() |> lower_first(), value)
    end)
  end

  defp lower_first(<<first, rest::binary>>) do
    String.downcase(<<first>>) <> rest
  end

  defp lower_first(value), do: value
end

defmodule HiveServerElixir.TemplatesTypedController do
  use AshTypescript.TypedController

  alias HiveServerElixir.Templates

  typed_controller do
    module_name(HiveServerElixirWeb.TemplatesController)

    route :list_templates do
      method(:get)
      argument(:workspace_id, :string)

      run(fn conn, params ->
        case templates_payload(params, conn) do
          {:ok, payload} -> Phoenix.Controller.json(conn, payload)
          {:error, {status, message}} -> error_json(conn, status, message)
        end
      end)
    end

    route :show_template do
      method(:get)
      argument(:id, :string, allow_nil?: false)
      argument(:workspace_id, :string)

      run(fn conn, params ->
        case template_payload(params, conn) do
          {:ok, payload} -> Phoenix.Controller.json(conn, payload)
          {:error, {status, message}} -> error_json(conn, status, message)
        end
      end)
    end
  end

  defp templates_payload(params, conn) do
    with {:ok, payload} <- Templates.list_templates(resolve_workspace_id(params, conn)) do
      {:ok, serialize_templates_payload(payload)}
    end
  end

  defp template_payload(%{id: template_id} = params, conn) do
    with {:ok, payload} <- Templates.get_template(resolve_workspace_id(params, conn), template_id) do
      {:ok, serialize_template_payload(payload)}
    end
  end

  defp error_json(conn, status, message) do
    conn
    |> Plug.Conn.put_status(status)
    |> Phoenix.Controller.json(%{message: message})
  end

  defp resolve_workspace_id(params, conn) do
    query_workspace_id = params[:workspace_id]

    if is_binary(query_workspace_id) and byte_size(String.trim(query_workspace_id)) > 0 do
      String.trim(query_workspace_id)
    else
      case Plug.Conn.get_req_header(conn, "x-workspace-id") do
        [workspace_id | _rest] ->
          trimmed_workspace_id = String.trim(workspace_id)
          if byte_size(trimmed_workspace_id) > 0, do: trimmed_workspace_id, else: nil

        _other ->
          nil
      end
    end
  end

  defp serialize_templates_payload(payload) do
    %{templates: Enum.map(Map.get(payload, :templates, []), &serialize_template_payload/1)}
    |> maybe_put_defaults(Map.get(payload, :defaults))
    |> maybe_put_agent_defaults(Map.get(payload, :agent_defaults))
  end

  defp serialize_template_payload(payload) do
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

  defp maybe_put_include_directories(payload, include_directories) do
    Map.put(payload, :includeDirectories, include_directories)
  end

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

defmodule HiveServerElixir.Templates.Support.CatalogLoader do
  @moduledoc false

  alias HiveServerElixir.Workspaces

  @hive_config_filename "hive.config.json"
  @opencode_config_filenames ["@opencode.json", "opencode.json"]

  @spec list_templates(String.t() | nil) :: {:ok, map()} | {:error, {atom(), String.t()}}
  def list_templates(workspace_id) do
    with {:ok, workspace} <- resolve_workspace(workspace_id),
         {:ok, config} <- load_workspace_config(workspace.path) do
      templates = list_template_payloads(config)
      defaults = build_defaults(config)
      agent_defaults = load_agent_defaults(workspace.path)

      {:ok,
       %{
         templates: templates,
         defaults: if(map_size(defaults) == 0, do: nil, else: defaults),
         agent_defaults: agent_defaults
       }}
    end
  end

  @spec get_template(String.t() | nil, String.t()) ::
          {:ok, map()} | {:error, {atom(), String.t()}}
  def get_template(workspace_id, template_id) when is_binary(template_id) do
    with {:ok, workspace} <- resolve_workspace(workspace_id),
         {:ok, config} <- load_workspace_config(workspace.path),
         {:ok, template} <- fetch_template(config, template_id) do
      {:ok, template}
    end
  end

  defp resolve_workspace(workspace_id) do
    case Workspaces.resolve(workspace_id) do
      {:ok, workspace} ->
        {:ok, workspace}

      {:error, :workspace_not_found} when is_binary(workspace_id) ->
        {:error, {:bad_request, "Workspace '#{workspace_id}' not found"}}

      {:error, :workspace_required} ->
        {:error,
         {:bad_request, "No active workspace. Register and activate a workspace to continue."}}
    end
  end

  defp load_workspace_config(workspace_path) do
    config_path = Path.join(workspace_path, @hive_config_filename)

    case File.read(config_path) do
      {:ok, contents} ->
        case Jason.decode(contents) do
          {:ok, decoded} when is_map(decoded) ->
            {:ok, decoded}

          {:ok, _decoded} ->
            {:error,
             {:bad_request,
              "Failed to load workspace config for workspace '#{workspace_path}': Invalid config format"}}

          {:error, %Jason.DecodeError{} = error} ->
            {:error,
             {:bad_request,
              "Failed to load workspace config for workspace '#{workspace_path}': #{Exception.message(error)}"}}
        end

      {:error, reason} ->
        {:error,
         {:bad_request,
          "Failed to load workspace config for workspace '#{workspace_path}': #{:file.format_error(reason)}"}}
    end
  end

  defp list_template_payloads(config) do
    config
    |> Map.get("templates", %{})
    |> case do
      templates when is_map(templates) -> templates
      _other -> %{}
    end
    |> Enum.map(fn {id, template} -> serialize_template(id, template) end)
  end

  defp build_defaults(config) do
    defaults =
      case Map.get(config, "defaults") do
        map when is_map(map) -> map
        _other -> %{}
      end

    start_mode =
      defaults["startMode"] || get_in(config, ["opencode", "defaultMode"]) || "plan"

    normalized_start_mode = normalize_start_mode(start_mode)

    defaults
    |> Map.put("startMode", normalized_start_mode)
    |> Map.take(["templateId", "startMode"])
    |> camelize_map_keys()
  end

  defp normalize_start_mode("build"), do: "build"
  defp normalize_start_mode(_mode), do: "plan"

  defp load_agent_defaults(workspace_path) do
    @opencode_config_filenames
    |> Enum.map(&Path.join(workspace_path, &1))
    |> Enum.find_value(fn config_path ->
      with {:ok, contents} <- File.read(config_path),
           {:ok, decoded} <- Jason.decode(contents),
           model when is_binary(model) <- Map.get(decoded, "model") do
        parse_model_defaults(model)
      else
        _other -> nil
      end
    end)
  end

  defp parse_model_defaults(model) do
    case model |> String.trim() |> String.split("/", parts: 2) do
      [provider_id, model_id] when provider_id != "" and model_id != "" ->
        %{provider_id: provider_id, model_id: model_id}

      [model_id] when model_id != "" ->
        %{model_id: model_id}

      _other ->
        nil
    end
  end

  defp fetch_template(config, template_id) do
    templates = Map.get(config, "templates", %{})

    template =
      case templates do
        map when is_map(map) -> Map.get(map, template_id)
        _other -> nil
      end

    if is_map(template) do
      {:ok, serialize_template(template_id, template)}
    else
      {:error, {:not_found, "Template '#{template_id}' not found"}}
    end
  end

  defp serialize_template(id, template) when is_map(template) do
    label =
      case Map.get(template, "label") do
        value when is_binary(value) and byte_size(value) > 0 -> value
        _value -> id
      end

    type =
      case Map.get(template, "type") do
        value when is_binary(value) and byte_size(value) > 0 -> value
        _value -> "manual"
      end

    include_directories = derive_include_directories(Map.get(template, "includePatterns"))

    %{
      id: id,
      label: label,
      type: type,
      config_json: template,
      include_directories: if(include_directories == [], do: nil, else: include_directories)
    }
  end

  defp derive_include_directories(patterns) when is_list(patterns) do
    patterns
    |> Enum.flat_map(fn pattern ->
      case pattern do
        value when is_binary(value) ->
          normalized =
            value
            |> String.trim()
            |> String.replace_prefix("./", "")
            |> String.replace_prefix("**/", "")

          case String.split(normalized, "/", trim: true) do
            [segment | _rest] ->
              if segment not in ["", "**"] and not String.contains?(segment, "*") do
                [segment]
              else
                []
              end

            _other ->
              []
          end

        _other ->
          []
      end
    end)
    |> Enum.uniq()
    |> Enum.sort()
  end

  defp derive_include_directories(_patterns), do: []

  defp camelize_map_keys(map) when is_map(map) do
    Enum.reduce(map, %{}, fn {key, value}, acc ->
      Map.put(acc, Macro.camelize(key) |> lower_first(), value)
    end)
  end

  defp lower_first(<<first, rest::binary>>) do
    String.downcase(<<first>>) <> rest
  end

  defp lower_first(value), do: value
end

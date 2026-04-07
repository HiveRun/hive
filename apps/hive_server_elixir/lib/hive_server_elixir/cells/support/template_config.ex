defmodule HiveServerElixir.Cells.TemplateConfig do
  @moduledoc false

  alias HiveServerElixir.Cells.WorkspaceConfig

  @spec load_workspace_config(String.t()) :: {:ok, map()} | {:error, String.t()}
  def load_workspace_config(workspace_root_path) when is_binary(workspace_root_path) do
    WorkspaceConfig.load(workspace_root_path)
    |> case do
      {:ok, config} -> {:ok, config}
      {:error, reason} -> {:error, "Failed to load workspace config: #{reason}"}
    end
  end

  def load_workspace_config(_workspace_root_path),
    do: {:error, "Failed to load workspace config: invalid workspace path"}

  @spec load_agent_defaults(String.t()) ::
          %{provider_id: String.t(), model_id: String.t()} | %{model_id: String.t()} | nil
  def load_agent_defaults(workspace_root_path) when is_binary(workspace_root_path) do
    WorkspaceConfig.model_defaults(workspace_root_path)
  end

  def load_agent_defaults(_workspace_root_path), do: nil

  @spec fetch_template(String.t(), String.t()) :: {:ok, map()} | {:error, String.t()}
  def fetch_template(workspace_root_path, template_id)
      when is_binary(workspace_root_path) and is_binary(template_id) do
    with {:ok, config} <- load_workspace_config(workspace_root_path),
         {:ok, template} <- extract_template(config, template_id) do
      {:ok, normalize_template(template_id, template)}
    end
  end

  def fetch_template(_workspace_root_path, _template_id), do: {:error, "Template not found"}

  defp extract_template(config, template_id) do
    templates = Map.get(config, "templates")

    case templates do
      map when is_map(map) ->
        case Map.get(map, template_id) do
          template when is_map(template) -> {:ok, template}
          _other -> {:error, "Template '#{template_id}' not found"}
        end

      _other ->
        {:error, "Template '#{template_id}' not found"}
    end
  end

  defp normalize_template(template_id, template) do
    %{
      id: template_id,
      label: normalize_string(Map.get(template, "label"), template_id),
      setup: normalize_commands(Map.get(template, "setup")),
      env: normalize_env(Map.get(template, "env")),
      services: normalize_services(Map.get(template, "services")),
      ignore_patterns: normalize_patterns(Map.get(template, "ignorePatterns"))
    }
  end

  defp normalize_services(services) when is_map(services) do
    services
    |> Enum.map(fn {name, definition} -> normalize_service(name, definition) end)
    |> Enum.reject(&is_nil/1)
  end

  defp normalize_services(_services), do: []

  defp normalize_service(name, definition) when is_binary(name) and is_map(definition) do
    case normalize_string(Map.get(definition, "type"), "process") do
      "process" ->
        command = Map.get(definition, "run")

        if is_binary(command) and String.trim(command) != "" do
          %{
            name: name,
            type: "process",
            command: String.trim(command),
            cwd: normalize_optional_string(Map.get(definition, "cwd")),
            env: normalize_env(Map.get(definition, "env")),
            ready_timeout_ms: normalize_integer(Map.get(definition, "readyTimeoutMs")),
            definition: definition
          }
        else
          nil
        end

      _other ->
        nil
    end
  end

  defp normalize_service(_name, _definition), do: nil

  defp normalize_commands(commands) when is_list(commands) do
    commands
    |> Enum.filter(&is_binary/1)
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
  end

  defp normalize_commands(_commands), do: []

  defp normalize_patterns(patterns) when is_list(patterns) do
    patterns
    |> Enum.filter(&is_binary/1)
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
  end

  defp normalize_patterns(_patterns), do: []

  defp normalize_env(env) when is_map(env) do
    Enum.reduce(env, %{}, fn {key, value}, acc ->
      cond do
        is_binary(key) and is_binary(value) -> Map.put(acc, key, value)
        is_atom(key) and is_binary(value) -> Map.put(acc, Atom.to_string(key), value)
        true -> acc
      end
    end)
  end

  defp normalize_env(_env), do: %{}

  defp normalize_integer(value) when is_integer(value) and value > 0, do: value
  defp normalize_integer(_value), do: nil

  defp normalize_optional_string(value) when is_binary(value) do
    trimmed = String.trim(value)
    if trimmed == "", do: nil, else: trimmed
  end

  defp normalize_optional_string(_value), do: nil

  defp normalize_string(value, default) when is_binary(value) do
    trimmed = String.trim(value)
    if trimmed == "", do: default, else: trimmed
  end

  defp normalize_string(_value, default), do: default
end

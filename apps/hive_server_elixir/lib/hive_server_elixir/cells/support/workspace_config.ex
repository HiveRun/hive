defmodule HiveServerElixir.Cells.WorkspaceConfig do
  @moduledoc false

  @hive_config_filename "hive.config.json"
  @opencode_config_filenames ["@opencode.json", "opencode.json"]

  @spec load(String.t()) :: {:ok, map()} | {:error, String.t()}
  def load(workspace_path) when is_binary(workspace_path) do
    config_path = Path.join(workspace_path, @hive_config_filename)

    case File.read(config_path) do
      {:ok, contents} ->
        case Jason.decode(contents) do
          {:ok, decoded} when is_map(decoded) -> {:ok, decoded}
          {:ok, _decoded} -> {:error, "Failed to load workspace config: invalid config format"}
          {:error, %Jason.DecodeError{} = error} -> {:error, Exception.message(error)}
        end

      {:error, reason} ->
        {:error, :file.format_error(reason)}
    end
  end

  def load(_workspace_path), do: {:error, "invalid workspace path"}

  @spec model_defaults(String.t()) ::
          %{provider_id: String.t(), model_id: String.t()} | %{model_id: String.t()} | nil
  def model_defaults(workspace_path) when is_binary(workspace_path) do
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

  def model_defaults(_workspace_path), do: nil

  defp parse_model_defaults(model) when is_binary(model) do
    case model |> String.trim() |> String.split("/", parts: 2) do
      [provider_id, model_id] when provider_id != "" and model_id != "" ->
        %{provider_id: provider_id, model_id: model_id}

      [model_id] when model_id != "" ->
        %{model_id: model_id}

      _other ->
        nil
    end
  end
end

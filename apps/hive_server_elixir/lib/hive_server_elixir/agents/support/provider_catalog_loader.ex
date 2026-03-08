defmodule HiveServerElixir.Agents.Support.ProviderCatalogLoader do
  @moduledoc false

  alias HiveServerElixir.Cells.AgentSessionRead
  alias HiveServerElixir.Opencode.Generated.Operations
  alias HiveServerElixir.Workspaces

  @spec for_workspace(String.t() | nil) :: {:ok, map()} | {:error, {atom(), String.t()}}
  def for_workspace(workspace_id) do
    with {:ok, workspace} <- resolve_workspace(workspace_id),
         {:ok, catalog} <- fetch_provider_catalog(workspace.path) do
      {:ok, provider_payload_from_catalog(catalog)}
    end
  end

  @spec for_session(String.t()) :: {:ok, map()} | {:error, {atom(), String.t()}}
  def for_session(session_id) when is_binary(session_id) do
    with {:ok, context} <- AgentSessionRead.context_for_session(session_id),
         {:ok, catalog} <- fetch_provider_catalog(context.cell.workspace_path) do
      {:ok, provider_payload_from_catalog(catalog)}
    end
  end

  defp resolve_workspace(workspace_id) do
    case Workspaces.resolve(workspace_id) do
      {:ok, workspace} ->
        {:ok, workspace}

      {:error, :workspace_not_found} ->
        {:error, {:bad_request, "Workspace '#{workspace_id}' not found"}}

      {:error, :workspace_required} ->
        {:error,
         {:bad_request, "No active workspace. Register and activate a workspace to continue."}}
    end
  end

  defp fetch_provider_catalog(workspace_path) do
    opts = [directory: workspace_path, client: opencode_client()] ++ opencode_client_opts()

    case Operations.config_providers(opts) do
      {:ok, catalog} ->
        {:ok, catalog}

      {:error, %{status: status, body: body}} ->
        {:error, {status_to_http_status(status), error_message(body)}}

      {:error, _reason} ->
        {:error, {:bad_request, "Failed to list models"}}

      :error ->
        {:error, {:bad_request, "Failed to list models"}}
    end
  end

  defp provider_payload_from_catalog(catalog) do
    providers =
      catalog
      |> read_key("providers")
      |> normalize_provider_entries()

    defaults = catalog |> read_key("default") |> normalize_provider_defaults()

    %{
      models: flatten_provider_models(providers),
      defaults: defaults,
      providers: serialize_provider_metadata(providers)
    }
  end

  defp normalize_provider_entries(value) when is_list(value) do
    value
    |> Enum.map(fn candidate ->
      provider_id = read_key(candidate, "id")
      provider_name = read_key(candidate, "name")
      provider_models = read_key(candidate, "models")

      if is_binary(provider_id) do
        %{
          id: provider_id,
          name: if(is_binary(provider_name), do: provider_name, else: nil),
          models: if(is_map(provider_models), do: provider_models, else: %{})
        }
      else
        nil
      end
    end)
    |> Enum.reject(&is_nil/1)
  end

  defp normalize_provider_entries(_value), do: []

  defp flatten_provider_models(providers) do
    providers
    |> Enum.flat_map(fn provider ->
      provider.models
      |> Enum.map(fn {model_key, model_value} ->
        model_id = read_key(model_value, "id") || model_key
        model_name = read_key(model_value, "name") || model_id

        %{
          id: to_string(model_id),
          name: to_string(model_name),
          provider: provider.id
        }
      end)
    end)
  end

  defp normalize_provider_defaults(value) when is_map(value) do
    value
    |> Enum.reduce(%{}, fn {provider_id, model_id}, acc ->
      if is_binary(model_id) do
        Map.put(acc, to_string(provider_id), model_id)
      else
        acc
      end
    end)
  end

  defp normalize_provider_defaults(_value), do: %{}

  defp serialize_provider_metadata(providers) do
    Enum.map(providers, fn provider ->
      if is_binary(provider.name) do
        %{id: provider.id, name: provider.name}
      else
        %{id: provider.id}
      end
    end)
  end

  defp opencode_client do
    Application.get_env(:hive_server_elixir, :opencode_client, HiveServerElixir.Opencode.Client)
  end

  defp opencode_client_opts do
    case Application.get_env(:hive_server_elixir, :opencode_client_opts, []) do
      opts when is_list(opts) -> opts
      _value -> []
    end
  end

  defp status_to_http_status(status) when status in [404], do: :not_found
  defp status_to_http_status(_status), do: :bad_request

  defp error_message(%{"message" => message}) when is_binary(message), do: message
  defp error_message(%{message: message}) when is_binary(message), do: message
  defp error_message(_body), do: "Failed to list models"

  defp read_key(value, key) when is_map(value) and is_binary(key) do
    case Map.fetch(value, key) do
      {:ok, found} ->
        found

      :error ->
        case AgentSessionRead.maybe_existing_atom(key) do
          atom when is_atom(atom) -> Map.get(value, atom)
          _other -> nil
        end
    end
  end

  defp read_key(_value, _key), do: nil
end

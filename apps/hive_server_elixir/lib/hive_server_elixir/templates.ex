defmodule HiveServerElixir.Templates do
  @moduledoc false

  use Ash.Domain

  alias HiveServerElixir.Templates.Catalog

  resources do
    resource Catalog
  end

  @spec list_templates(String.t() | nil) :: {:ok, map()} | {:error, term()}
  def list_templates(workspace_id \\ nil) do
    Catalog
    |> Ash.ActionInput.for_action(:list_templates, %{workspace_id: workspace_id})
    |> Ash.run_action(domain: __MODULE__)
    |> normalize_result()
  end

  @spec get_template(String.t() | nil, String.t()) :: {:ok, map()} | {:error, term()}
  def get_template(workspace_id, template_id) when is_binary(template_id) do
    Catalog
    |> Ash.ActionInput.for_action(:get_template, %{
      workspace_id: workspace_id,
      template_id: template_id
    })
    |> Ash.run_action(domain: __MODULE__)
    |> normalize_result()
  end

  defp normalize_result({:ok, payload}), do: {:ok, payload}

  defp normalize_result({:error, %Ash.Error.Unknown{errors: errors} = error}) do
    case Enum.find_value(errors, &extract_known_error/1) do
      nil -> {:error, error}
      known_error -> {:error, known_error}
    end
  end

  defp normalize_result(other), do: other

  defp extract_known_error(%{value: value}) when is_list(value) do
    case value do
      [{status, message}] when status in [:bad_request, :not_found] and is_binary(message) ->
        {status, message}

      _other ->
        nil
    end
  end

  defp extract_known_error(_error), do: nil
end

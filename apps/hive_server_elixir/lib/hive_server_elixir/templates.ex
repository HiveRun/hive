defmodule HiveServerElixir.Templates do
  @moduledoc false

  use Ash.Domain

  alias HiveServerElixir.AshActionResult
  alias HiveServerElixir.Templates.Catalog

  resources do
    resource Catalog
  end

  @spec list_templates(String.t() | nil) :: {:ok, map()} | {:error, term()}
  def list_templates(workspace_id \\ nil) do
    Catalog
    |> Ash.ActionInput.for_action(:list_templates, %{workspace_id: workspace_id})
    |> Ash.run_action(domain: __MODULE__)
    |> AshActionResult.normalize()
  end

  @spec get_template(String.t() | nil, String.t()) :: {:ok, map()} | {:error, term()}
  def get_template(workspace_id, template_id) when is_binary(template_id) do
    Catalog
    |> Ash.ActionInput.for_action(:get_template, %{
      workspace_id: workspace_id,
      template_id: template_id
    })
    |> Ash.run_action(domain: __MODULE__)
    |> AshActionResult.normalize()
  end
end

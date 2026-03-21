defmodule HiveServerElixir.Templates.Catalog do
  @moduledoc false

  alias HiveServerElixir.Templates.Support.CatalogLoader

  use Ash.Resource, domain: HiveServerElixir.Templates

  @template_fields [
    id: [type: :string, allow_nil?: false],
    label: [type: :string, allow_nil?: false],
    type: [type: :string, allow_nil?: false],
    config_json: [type: :map, allow_nil?: false],
    include_directories: [type: {:array, :string}, allow_nil?: true]
  ]

  @list_payload_fields [
    templates: [type: {:array, :map}, allow_nil?: false],
    defaults: [type: :map, allow_nil?: true],
    agent_defaults: [type: :map, allow_nil?: true]
  ]

  actions do
    defaults []

    action :list_templates, :map do
      constraints fields: @list_payload_fields

      argument :workspace_id, :string do
        allow_nil? true
        public? true
      end

      run fn input, _context ->
        CatalogLoader.list_templates(input.arguments.workspace_id)
      end
    end

    action :get_template, :map do
      constraints fields: @template_fields

      argument :workspace_id, :string do
        allow_nil? true
        public? true
      end

      argument :template_id, :string do
        allow_nil? false
        public? true
      end

      run fn input, _context ->
        CatalogLoader.get_template(input.arguments.workspace_id, input.arguments.template_id)
      end
    end
  end
end

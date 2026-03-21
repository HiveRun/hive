defmodule HiveServerElixir.Agents.ProviderCatalog do
  @moduledoc false

  alias HiveServerElixir.Agents.Support.ProviderCatalogLoader

  use Ash.Resource, domain: HiveServerElixir.Agents

  actions do
    defaults []

    action :for_workspace, :map do
      argument :workspace_id, :string do
        allow_nil? true
        public? true
      end

      run fn input, _context ->
        ProviderCatalogLoader.for_workspace(input.arguments.workspace_id)
      end
    end

    action :for_session, :map do
      argument :session_id, :string do
        allow_nil? false
        public? true
      end

      run fn input, _context ->
        ProviderCatalogLoader.for_session(input.arguments.session_id)
      end
    end
  end
end

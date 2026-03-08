defmodule HiveServerElixir.Cells.AgentSession do
  @moduledoc false

  alias HiveServerElixir.Agents

  use Ash.Resource,
    extensions: [AshTypescript.Resource],
    domain: HiveServerElixir.Cells,
    data_layer: AshSqlite.DataLayer

  @session_payload_fields [
    id: [type: :string, allow_nil?: true],
    cell_id: [type: :uuid, allow_nil?: true],
    template_id: [type: :string, allow_nil?: true],
    provider: [type: :string, allow_nil?: true],
    status: [type: :string, allow_nil?: true],
    workspace_path: [type: :string, allow_nil?: true],
    created_at: [type: :string, allow_nil?: true],
    updated_at: [type: :string, allow_nil?: true],
    model_id: [type: :string, allow_nil?: true],
    model_provider_id: [type: :string, allow_nil?: true],
    start_mode: [type: :string, allow_nil?: true],
    current_mode: [type: :string, allow_nil?: true],
    mode_updated_at: [type: :string, allow_nil?: true]
  ]

  typescript do
    type_name "AgentSession"
  end

  sqlite do
    table "cell_agent_sessions"
    repo HiveServerElixir.Repo
  end

  actions do
    defaults [:read, :destroy]

    create :create do
      primary? true

      accept [
        :cell_id,
        :session_id,
        :model_id,
        :model_provider_id,
        :start_mode,
        :current_mode,
        :resume_on_startup,
        :last_error
      ]
    end

    update :update do
      primary? true
      accept [:model_id, :model_provider_id, :current_mode, :resume_on_startup, :last_error]
    end

    action :get_session_by_cell, :map do
      constraints fields: @session_payload_fields

      argument :cell_id, :uuid do
        allow_nil? false
        public? true
      end

      run fn input, _context ->
        case Agents.session_payload_for_cell(input.arguments.cell_id) do
          {:ok, %{} = payload} -> {:ok, rpc_session_payload(payload)}
          {:ok, nil} -> {:ok, %{}}
        end
      end
    end

    action :set_session_mode, :map do
      constraints fields: @session_payload_fields

      argument :session_id, :string do
        allow_nil? false
        public? true
      end

      argument :mode, :string do
        allow_nil? false
        public? true
      end

      validate one_of(:mode, ["plan", "build"])

      run fn input, _context ->
        case Agents.set_session_mode(input.arguments.session_id, input.arguments.mode) do
          {:ok, payload} -> {:ok, rpc_session_payload(payload)}
          {:error, error} -> {:error, error}
        end
      end
    end
  end

  attributes do
    uuid_primary_key :id

    attribute :session_id, :string do
      allow_nil? false
      public? true
    end

    attribute :model_id, :string do
      allow_nil? true
      public? true
    end

    attribute :model_provider_id, :string do
      allow_nil? true
      public? true
    end

    attribute :start_mode, :string do
      allow_nil? true
      public? true
    end

    attribute :current_mode, :string do
      allow_nil? true
      public? true
    end

    attribute :resume_on_startup, :boolean do
      allow_nil? false
      public? true
      default false
    end

    attribute :last_error, :string do
      allow_nil? true
      public? true
    end

    create_timestamp :inserted_at
    update_timestamp :updated_at
  end

  relationships do
    belongs_to :cell, HiveServerElixir.Cells.Cell do
      allow_nil? false
      public? true
      attribute_writable? true
    end
  end

  identities do
    identity :unique_cell, [:cell_id]
    identity :unique_session_id, [:session_id]
  end

  defp rpc_session_payload(payload) do
    %{
      id: Map.get(payload, :id),
      cell_id: Map.get(payload, :cellId),
      template_id: Map.get(payload, :templateId),
      provider: Map.get(payload, :provider),
      status: Map.get(payload, :status),
      workspace_path: Map.get(payload, :workspacePath),
      created_at: Map.get(payload, :createdAt),
      updated_at: Map.get(payload, :updatedAt),
      model_id: Map.get(payload, :modelId),
      model_provider_id: Map.get(payload, :modelProviderId),
      start_mode: Map.get(payload, :startMode),
      current_mode: Map.get(payload, :currentMode),
      mode_updated_at: Map.get(payload, :modeUpdatedAt)
    }
  end
end

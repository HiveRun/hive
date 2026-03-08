defmodule HiveServerElixir.Cells.Cell do
  @moduledoc false

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.CellStatus
  alias HiveServerElixir.Cells.ServicePayload

  @cell_payload_fields [
    id: [type: :uuid, allow_nil?: false],
    name: [type: :string, allow_nil?: false],
    workspace_id: [type: :uuid, allow_nil?: false],
    description: [type: :string, allow_nil?: true],
    template_id: [type: :string, allow_nil?: false],
    workspace_root_path: [type: :string, allow_nil?: false],
    workspace_path: [type: :string, allow_nil?: false],
    opencode_session_id: [type: :string, allow_nil?: true],
    opencode_command: [type: :string, allow_nil?: true],
    created_at: [type: :string, allow_nil?: true],
    status: [type: :string, allow_nil?: false],
    last_setup_error: [type: :string, allow_nil?: true],
    branch_name: [type: :string, allow_nil?: true],
    base_commit: [type: :string, allow_nil?: true],
    updated_at: [type: :string, allow_nil?: true]
  ]

  @delete_payload_fields [
    deleted_id: [type: :uuid, allow_nil?: false],
    workspace_id: [type: :uuid, allow_nil?: false]
  ]

  @delete_many_payload_fields [
    deleted_ids: [type: {:array, :uuid}, allow_nil?: false],
    failed_ids: [type: {:array, :uuid}, allow_nil?: false]
  ]

  @service_payload_fields ServicePayload.fields()

  use Ash.Resource,
    extensions: [AshTypescript.Resource],
    domain: HiveServerElixir.Cells,
    data_layer: AshSqlite.DataLayer

  typescript do
    type_name "Cell"
  end

  sqlite do
    table "cells"
    repo HiveServerElixir.Repo
  end

  actions do
    defaults [:read, :destroy]

    read :ui_list do
      argument :workspace_id, :uuid do
        allow_nil? true
        public? true
      end

      prepare build(sort: [inserted_at: :asc])

      filter expr(
               status != :deleting and
                 (is_nil(^arg(:workspace_id)) or workspace_id == ^arg(:workspace_id))
             )
    end

    read :ui_get do
      argument :id, :uuid do
        allow_nil? false
        public? true
      end

      filter expr(id == ^arg(:id) and status != :deleting)
    end

    action :create_cell, :map do
      constraints fields: @cell_payload_fields

      argument :workspace_id, :uuid do
        allow_nil? false
        public? true
      end

      argument :name, :string do
        allow_nil? true
        public? true
      end

      argument :description, :string do
        allow_nil? true
        public? true
      end

      argument :template_id, :string do
        allow_nil? false
        default "default-template"
        public? true
      end

      argument :start_mode, :string do
        allow_nil? false
        default "plan"
        public? true
      end

      validate one_of(:start_mode, ["plan", "build"])

      run fn input, _context ->
        Cells.create_cell_rpc(input.arguments)
      end
    end

    action :retry_cell_setup, :map do
      constraints fields: @cell_payload_fields

      argument :cell_id, :uuid do
        allow_nil? false
        public? true
      end

      argument :source, :string do
        allow_nil? true
        public? true
      end

      argument :tool_name, :string do
        allow_nil? true
        public? true
      end

      argument :audit_event, :string do
        allow_nil? true
        public? true
      end

      argument :service_name, :string do
        allow_nil? true
        public? true
      end

      run fn input, _context ->
        Cells.retry_cell_setup_rpc(input.arguments)
      end
    end

    action :resume_cell_setup, :map do
      constraints fields: @cell_payload_fields

      argument :cell_id, :uuid do
        allow_nil? false
        public? true
      end

      run fn input, _context ->
        Cells.resume_cell_setup_rpc(input.arguments)
      end
    end

    action :delete_cell, :map do
      constraints fields: @delete_payload_fields

      argument :cell_id, :uuid do
        allow_nil? false
        public? true
      end

      run fn input, _context ->
        Cells.delete_cell_rpc(input.arguments)
      end
    end

    action :delete_many_cells, :map do
      constraints fields: @delete_many_payload_fields

      argument :ids, {:array, :uuid} do
        allow_nil? false
        public? true
      end

      run fn input, _context ->
        Cells.delete_many_cells_rpc(input.arguments)
      end
    end

    action :list_services, {:array, :map} do
      constraints items: [fields: @service_payload_fields]

      argument :cell_id, :uuid do
        allow_nil? false
        public? true
      end

      argument :include_resources, :boolean do
        allow_nil? false
        default false
        public? true
      end

      argument :log_lines, :integer do
        allow_nil? true
        public? true
      end

      argument :log_offset, :integer do
        allow_nil? true
        public? true
      end

      run fn input, _context ->
        Cells.list_services_rpc(input.arguments)
      end
    end

    action :start_services, {:array, :map} do
      constraints items: [fields: @service_payload_fields]

      argument :cell_id, :uuid do
        allow_nil? false
        public? true
      end

      argument :source, :string do
        allow_nil? true
        public? true
      end

      argument :tool_name, :string do
        allow_nil? true
        public? true
      end

      argument :audit_event, :string do
        allow_nil? true
        public? true
      end

      argument :service_name, :string do
        allow_nil? true
        public? true
      end

      run fn input, _context ->
        Cells.start_services_rpc(input.arguments)
      end
    end

    action :stop_services, {:array, :map} do
      constraints items: [fields: @service_payload_fields]

      argument :cell_id, :uuid do
        allow_nil? false
        public? true
      end

      argument :source, :string do
        allow_nil? true
        public? true
      end

      argument :tool_name, :string do
        allow_nil? true
        public? true
      end

      argument :audit_event, :string do
        allow_nil? true
        public? true
      end

      argument :service_name, :string do
        allow_nil? true
        public? true
      end

      run fn input, _context ->
        Cells.stop_services_rpc(input.arguments)
      end
    end

    action :restart_services, {:array, :map} do
      constraints items: [fields: @service_payload_fields]

      argument :cell_id, :uuid do
        allow_nil? false
        public? true
      end

      argument :source, :string do
        allow_nil? true
        public? true
      end

      argument :tool_name, :string do
        allow_nil? true
        public? true
      end

      argument :audit_event, :string do
        allow_nil? true
        public? true
      end

      argument :service_name, :string do
        allow_nil? true
        public? true
      end

      run fn input, _context ->
        Cells.restart_services_rpc(input.arguments)
      end
    end

    create :create do
      primary? true

      accept [
        :workspace_id,
        :name,
        :description,
        :template_id,
        :workspace_root_path,
        :workspace_path,
        :opencode_session_id,
        :resume_agent_session_on_startup,
        :status,
        :last_setup_error,
        :branch_name,
        :base_commit
      ]

      change fn changeset, _context ->
        changeset
        |> ensure_default_attribute(:workspace_root_path, ".")
        |> ensure_default_attribute(:workspace_path, ".")
      end
    end

    update :update do
      primary? true

      accept [
        :name,
        :description,
        :template_id,
        :workspace_root_path,
        :workspace_path,
        :opencode_session_id,
        :resume_agent_session_on_startup,
        :status,
        :last_setup_error,
        :branch_name,
        :base_commit
      ]
    end
  end

  attributes do
    uuid_primary_key :id

    attribute :name, :string do
      allow_nil? false
      public? true
      default "Cell"
    end

    attribute :description, :string do
      allow_nil? true
      public? true
    end

    attribute :template_id, :string do
      allow_nil? false
      public? true
      default "default-template"
    end

    attribute :workspace_root_path, :string do
      allow_nil? false
      public? true
      default "."
    end

    attribute :workspace_path, :string do
      allow_nil? false
      public? true
      default "."
    end

    attribute :opencode_session_id, :string do
      allow_nil? true
      public? true
    end

    attribute :resume_agent_session_on_startup, :boolean do
      allow_nil? false
      public? true
      default false
    end

    attribute :status, CellStatus do
      allow_nil? false
      public? true
      default :provisioning
    end

    attribute :last_setup_error, :string do
      allow_nil? true
      public? true
    end

    attribute :branch_name, :string do
      allow_nil? true
      public? true
    end

    attribute :base_commit, :string do
      allow_nil? true
      public? true
    end

    create_timestamp :inserted_at, public?: true
    update_timestamp :updated_at, public?: true
  end

  relationships do
    belongs_to :workspace, HiveServerElixir.Cells.Workspace do
      allow_nil? false
      public? true
      attribute_writable? true
    end

    has_one :provisioning_state, HiveServerElixir.Cells.Provisioning do
      destination_attribute :cell_id
    end

    has_one :agent_session, HiveServerElixir.Cells.AgentSession do
      destination_attribute :cell_id
    end

    has_many :services, HiveServerElixir.Cells.Service do
      destination_attribute :cell_id
    end

    has_many :activity_events, HiveServerElixir.Cells.Activity do
      destination_attribute :cell_id
    end

    has_many :timing_events, HiveServerElixir.Cells.Timing do
      destination_attribute :cell_id
    end
  end

  defp ensure_default_attribute(changeset, attribute, default_value) do
    case Ash.Changeset.get_attribute(changeset, attribute) do
      nil -> Ash.Changeset.force_change_attribute(changeset, attribute, default_value)
      _value -> changeset
    end
  end
end

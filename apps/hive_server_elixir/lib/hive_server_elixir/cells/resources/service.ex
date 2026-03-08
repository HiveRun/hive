defmodule HiveServerElixir.Cells.Service do
  @moduledoc false

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.ServicePayload

  use Ash.Resource,
    extensions: [AshTypescript.Resource],
    domain: HiveServerElixir.Cells,
    data_layer: AshSqlite.DataLayer

  @service_payload_fields ServicePayload.fields()

  typescript do
    type_name "Service"
  end

  sqlite do
    table "cell_services"
    repo HiveServerElixir.Repo
  end

  actions do
    defaults [:read, :destroy]

    action :start_service, :map do
      constraints fields: @service_payload_fields

      argument :service_id, :uuid do
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
        Cells.start_service_rpc(input.arguments)
      end
    end

    action :stop_service, :map do
      constraints fields: @service_payload_fields

      argument :service_id, :uuid do
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
        Cells.stop_service_rpc(input.arguments)
      end
    end

    action :restart_service, :map do
      constraints fields: @service_payload_fields

      argument :service_id, :uuid do
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
        Cells.restart_service_rpc(input.arguments)
      end
    end

    create :create do
      primary? true

      accept [
        :cell_id,
        :name,
        :type,
        :command,
        :cwd,
        :env,
        :status,
        :port,
        :pid,
        :ready_timeout_ms,
        :definition,
        :last_known_error
      ]
    end

    update :update do
      primary? true
      accept [:status, :port, :pid, :last_known_error]
    end
  end

  attributes do
    uuid_primary_key :id

    attribute :name, :string do
      allow_nil? false
      public? true
    end

    attribute :type, :string do
      allow_nil? false
      public? true
    end

    attribute :command, :string do
      allow_nil? false
      public? true
    end

    attribute :cwd, :string do
      allow_nil? false
      public? true
    end

    attribute :env, :map do
      allow_nil? false
      public? true
      default %{}
    end

    attribute :status, :string do
      allow_nil? false
      public? true
      default "pending"
    end

    attribute :port, :integer do
      allow_nil? true
      public? true
    end

    attribute :pid, :integer do
      allow_nil? true
      public? true
    end

    attribute :ready_timeout_ms, :integer do
      allow_nil? true
      public? true
    end

    attribute :definition, :map do
      allow_nil? false
      public? true
      default %{}
    end

    attribute :last_known_error, :string do
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
end

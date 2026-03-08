defmodule HiveServerElixir.Cells.Service do
  @moduledoc false

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.ServicePayload
  alias HiveServerElixir.Cells.ServiceStatus

  use Ash.Resource,
    extensions: [AshTypescript.Resource],
    domain: HiveServerElixir.Cells,
    data_layer: AshSqlite.DataLayer

  @service_payload_fields ServicePayload.fields()
  @allowed_lifecycle_sources %{
    running: [:stopped, :error, :running],
    stopped: [:running, :error, :stopped],
    error: [:running, :stopped, :error]
  }

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
        :port,
        :ready_timeout_ms,
        :definition
      ]

      change fn changeset, _context ->
        changeset
        |> Ash.Changeset.force_change_attribute(:status, :stopped)
        |> Ash.Changeset.force_change_attribute(:pid, nil)
        |> Ash.Changeset.force_change_attribute(:last_known_error, nil)
      end
    end

    update :mark_running do
      accept [:pid, :port]
      require_atomic? false

      change fn changeset, _context ->
        changeset
        |> validate_lifecycle_transition(:running)
        |> Ash.Changeset.force_change_attribute(:status, :running)
        |> Ash.Changeset.force_change_attribute(:last_known_error, nil)
      end
    end

    update :mark_stopped do
      accept [:port]
      require_atomic? false

      change fn changeset, _context ->
        changeset
        |> validate_lifecycle_transition(:stopped)
        |> Ash.Changeset.force_change_attribute(:status, :stopped)
        |> Ash.Changeset.force_change_attribute(:pid, nil)
        |> Ash.Changeset.force_change_attribute(:last_known_error, nil)
      end
    end

    update :mark_error do
      accept [:last_known_error, :port]
      require_atomic? false

      change fn changeset, _context ->
        changeset
        |> validate_lifecycle_transition(:error)
        |> Ash.Changeset.force_change_attribute(:status, :error)
        |> Ash.Changeset.force_change_attribute(:pid, nil)
      end
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

    attribute :status, ServiceStatus do
      allow_nil? false
      public? true
      default :stopped
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

  defp validate_lifecycle_transition(changeset, target_status) do
    current_status = normalize_status(Ash.Changeset.get_data(changeset, :status))

    if current_status in Map.fetch!(@allowed_lifecycle_sources, target_status) do
      changeset
    else
      Ash.Changeset.add_error(
        changeset,
        field: :status,
        message:
          "cannot transition service status from #{format_status(current_status)} to #{format_status(target_status)}"
      )
    end
  end

  defp normalize_status(status) when is_binary(status) do
    case ServiceStatus.cast_input(status, []) do
      {:ok, normalized} -> normalized
      _other -> nil
    end
  end

  defp normalize_status(status) when is_atom(status), do: status
  defp normalize_status(_status), do: nil

  defp format_status(status) when is_atom(status), do: Atom.to_string(status)
  defp format_status(status) when is_binary(status), do: status
  defp format_status(_status), do: "unknown"
end

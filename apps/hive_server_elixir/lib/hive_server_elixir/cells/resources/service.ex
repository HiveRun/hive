defmodule HiveServerElixir.Cells.Service do
  @moduledoc false

  import Ash.Expr
  require Ash.Query

  alias HiveServerElixir.Cells.Activity
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.ServicePayload
  alias HiveServerElixir.Cells.ServiceReconciliation
  alias HiveServerElixir.Cells.ServiceRuntime
  alias HiveServerElixir.Cells.ServiceSnapshot
  alias HiveServerElixir.Cells.ServiceStatus

  use Ash.Resource,
    extensions: [AshTypescript.Resource, AshOban],
    notifiers: [Ash.Notifier.PubSub],
    domain: HiveServerElixir.Cells,
    data_layer: AshSqlite.DataLayer

  @service_payload_fields ServicePayload.fields()
  @terminal_control_payload_fields [ok: [type: :boolean, allow_nil?: false]]
  @allowed_lifecycle_sources %{
    running: [:stopped, :error, :running],
    stopped: [:running, :error, :stopped],
    error: [:running, :stopped, :error]
  }

  typescript do
    type_name "Service"
  end

  oban do
    scheduled_actions do
      schedule :reconcile_runtime_inventory, "*/1 * * * *" do
        action :reconcile_runtime_inventory
        queue :default
        worker_module_name __MODULE__.Oban.ReconcileRuntimeInventoryWorker
      end
    end
  end

  sqlite do
    table "cell_services"
    repo HiveServerElixir.Repo
  end

  actions do
    defaults [:read, :destroy]

    action :reconcile_runtime_inventory, :map do
      constraints fields: [reconciled_count: [type: :integer], updated_count: [type: :integer]]

      run fn _input, _context ->
        reconcile_runtime_inventory_payload()
      end
    end

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
        start_payload(input.arguments)
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
        stop_payload(input.arguments)
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
        restart_payload(input.arguments)
      end
    end

    action :service_terminal_input, :map do
      constraints fields: @terminal_control_payload_fields

      argument :service_id, :uuid do
        allow_nil? false
        public? true
      end

      argument :data, :string do
        allow_nil? false
        public? true
      end

      run fn input, _context ->
        terminal_input_payload(input.arguments)
      end
    end

    action :service_terminal_resize, :map do
      constraints fields: @terminal_control_payload_fields

      argument :service_id, :uuid do
        allow_nil? false
        public? true
      end

      argument :cols, :integer do
        allow_nil? false
        constraints min: 1
        public? true
      end

      argument :rows, :integer do
        allow_nil? false
        constraints min: 1
        public? true
      end

      run fn input, _context ->
        terminal_resize_payload(input.arguments)
      end
    end

    action :service_snapshot, :map do
      constraints fields: @service_payload_fields

      argument :service_id, :uuid do
        allow_nil? false
        public? true
      end

      run fn input, _context ->
        case Ash.get(__MODULE__, input.arguments.service_id) do
          {:ok, service} ->
            {:ok,
             ServiceSnapshot.transport_payload(service, %{
               include_resources: true,
               lines: 200,
               offset: 0
             })}

          {:error, error} ->
            {:error, error}
        end
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

    update :reconcile_runtime_state do
      accept [:status, :pid, :port, :last_known_error]
      require_atomic? false

      change fn changeset, _context ->
        reconcile_runtime_state(changeset)
      end
    end
  end

  pub_sub do
    module HiveServerElixirWeb.Endpoint
    prefix "services"

    publish :create, [:cell_id],
      event: "service_snapshot",
      public?: true,
      returns: :map,
      constraints: [fields: @service_payload_fields],
      transform: fn notification -> ServiceSnapshot.channel_payload(notification.data) end

    publish :mark_running, [:cell_id],
      event: "service_snapshot",
      public?: true,
      returns: :map,
      constraints: [fields: @service_payload_fields],
      transform: fn notification -> ServiceSnapshot.channel_payload(notification.data) end

    publish :mark_stopped, [:cell_id],
      event: "service_snapshot",
      public?: true,
      returns: :map,
      constraints: [fields: @service_payload_fields],
      transform: fn notification -> ServiceSnapshot.channel_payload(notification.data) end

    publish :mark_error, [:cell_id],
      event: "service_snapshot",
      public?: true,
      returns: :map,
      constraints: [fields: @service_payload_fields],
      transform: fn notification -> ServiceSnapshot.channel_payload(notification.data) end
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

  @spec reconcile_runtime_inventory_payload() :: {:ok, map()}
  def reconcile_runtime_inventory_payload do
    services = Ash.read!(__MODULE__)
    snapshots = ServiceReconciliation.reconcile_all(services)

    updated_count =
      services
      |> Enum.zip(snapshots)
      |> Enum.count(fn {service, snapshot} ->
        service.status != snapshot.service.status ||
          service.pid != snapshot.service.pid ||
          service.last_known_error != snapshot.service.last_known_error
      end)

    {:ok, %{reconciled_count: length(snapshots), updated_count: updated_count}}
  end

  @spec list_payloads(String.t(), map()) :: {:ok, [map()]} | {:error, term()}
  def list_payloads(cell_id, opts \\ %{}) when is_binary(cell_id) do
    with {:ok, _cell} <- Ash.get(Cell, cell_id) do
      {:ok, ServiceSnapshot.list_rpc_payloads(cell_id, snapshot_options(opts))}
    end
  end

  @spec start_payload(map()) :: {:ok, map()} | {:error, term()}
  def start_payload(input) when is_map(input) do
    lifecycle_payload(input, "service.start", &ensure_runtime_start/1, %{})
  end

  @spec stop_payload(map()) :: {:ok, map()} | {:error, term()}
  def stop_payload(input) when is_map(input) do
    lifecycle_payload(input, "service.stop", &ensure_runtime_stop/1, %{})
  end

  @spec restart_payload(map()) :: {:ok, map()} | {:error, term()}
  def restart_payload(input) when is_map(input) do
    lifecycle_payload(input, "service.restart", &ensure_runtime_restart/1, fn service ->
      %{"serviceName" => service.name}
    end)
  end

  @spec terminal_input_payload(map()) :: {:ok, map()} | {:error, term()}
  def terminal_input_payload(%{service_id: service_id, data: data}) when is_binary(data) do
    with {:ok, service} <- Ash.get(__MODULE__, service_id),
         :ok <- ServiceRuntime.ensure_service_running(service),
         :ok <- ServiceRuntime.write_input(service_id, data) do
      {:ok, %{ok: true}}
    else
      {:error, :not_running} -> {:error, "Service is not running"}
      {:error, error} -> {:error, inspect(error)}
    end
  end

  @spec terminal_resize_payload(map()) :: {:ok, map()} | {:error, term()}
  def terminal_resize_payload(%{service_id: service_id, cols: cols, rows: rows}) do
    with {:ok, service} <- Ash.get(__MODULE__, service_id) do
      _session =
        HiveServerElixir.Cells.Terminals.resize_session(
          {:service, service.cell_id, service_id},
          cols,
          rows
        )

      {:ok, %{ok: true}}
    else
      {:error, error} -> {:error, inspect(error)}
    end
  end

  @spec start_all_payloads(String.t(), map()) :: {:ok, [map()]} | {:error, term()}
  def start_all_payloads(cell_id, audit \\ %{}) when is_binary(cell_id) and is_map(audit) do
    batch_payloads(cell_id, audit, "services.start", &ensure_runtime_start/1)
  end

  @spec stop_all_payloads(String.t(), map()) :: {:ok, [map()]} | {:error, term()}
  def stop_all_payloads(cell_id, audit \\ %{}) when is_binary(cell_id) and is_map(audit) do
    batch_payloads(cell_id, audit, "services.stop", &ensure_runtime_stop/1)
  end

  @spec restart_all_payloads(String.t(), map()) :: {:ok, [map()]} | {:error, term()}
  def restart_all_payloads(cell_id, audit \\ %{}) when is_binary(cell_id) and is_map(audit) do
    batch_payloads(cell_id, audit, "services.restart", &ensure_runtime_restart/1)
  end

  @spec list_for_cell(String.t()) :: [map()]
  def list_for_cell(cell_id) when is_binary(cell_id) do
    __MODULE__
    |> Ash.Query.filter(expr(cell_id == ^cell_id))
    |> Ash.Query.sort(inserted_at: :asc)
    |> Ash.read!()
  end

  @spec snapshot_payload(map()) :: map()
  def snapshot_payload(%{service: service} = _snapshot) when is_map(service) do
    rpc_payload = ServiceSnapshot.rpc_payload(service)

    %{
      id: Map.get(rpc_payload, :id),
      cellId: service.cell_id,
      name: Map.get(rpc_payload, :name),
      type: Map.get(rpc_payload, :type),
      status: Map.get(rpc_payload, :status),
      pid: Map.get(rpc_payload, :pid),
      port: Map.get(rpc_payload, :port),
      command: Map.get(rpc_payload, :command),
      cwd: Map.get(rpc_payload, :cwd),
      env: Map.get(rpc_payload, :env),
      lastKnownError: Map.get(rpc_payload, :last_known_error),
      insertedAt: maybe_to_iso8601(service.inserted_at),
      updatedAt: Map.get(rpc_payload, :updated_at)
    }
  end

  def snapshot_payload(service) when is_map(service) do
    service
    |> ServiceReconciliation.reconcile()
    |> snapshot_payload()
  end

  @spec snapshot_payloads_for_cell(String.t()) :: [map()]
  def snapshot_payloads_for_cell(cell_id) when is_binary(cell_id) do
    cell_id
    |> list_for_cell()
    |> ServiceReconciliation.reconcile_all()
    |> Enum.map(&snapshot_payload/1)
  end

  @spec process_summary_payload(map(), String.t()) :: map()
  def process_summary_payload(%{service: service} = snapshot, sampled_at)
      when is_map(service) and is_binary(sampled_at) do
    %{
      kind: "service",
      serviceType: service.type,
      id: service.id,
      name: service.name,
      status: ServiceStatus.present(snapshot.status),
      pid: snapshot.pid,
      processAlive: snapshot.process_alive,
      active: snapshot.process_alive and ServiceStatus.running?(snapshot.status),
      cpuPercent: nil,
      rssBytes: nil,
      resourceSampledAt: sampled_at,
      resourceUnavailableReason: process_unavailable_reason(snapshot.pid, snapshot.process_alive)
    }
  end

  def process_summary_payload(service, sampled_at)
      when is_map(service) and is_binary(sampled_at) do
    service
    |> ServiceReconciliation.reconcile()
    |> process_summary_payload(sampled_at)
  end

  @spec snapshot_options(map()) :: map()
  def snapshot_options(input) when is_map(input) do
    %{
      include_resources: Map.get(input, :include_resources, false),
      lines: Map.get(input, :lines) || Map.get(input, :log_lines) || 200,
      offset: Map.get(input, :offset) || Map.get(input, :log_offset) || 0
    }
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

  defp lifecycle_payload(input, activity_type, runtime_fun, metadata_fun)
       when is_map(input) and is_function(runtime_fun, 1) do
    with {:ok, service} <- Ash.get(__MODULE__, Map.fetch!(input, :service_id)),
         :ok <- runtime_fun.(service),
         {:ok, updated_service} <- Ash.get(__MODULE__, service.id) do
      metadata = if is_function(metadata_fun, 1), do: metadata_fun.(service), else: metadata_fun
      _ = record_activity(service.cell_id, service.id, activity_type, input, metadata)
      {:ok, ServiceSnapshot.rpc_payload(updated_service)}
    end
  end

  defp batch_payloads(cell_id, audit, activity_type, runtime_fun)
       when is_binary(cell_id) and is_map(audit) and is_function(runtime_fun, 1) do
    with {:ok, _cell} <- Ash.get(Cell, cell_id),
         :ok <- apply_all(list_for_cell(cell_id), runtime_fun) do
      _ = record_activity(cell_id, nil, activity_type, audit, %{})
      {:ok, ServiceSnapshot.list_rpc_payloads(cell_id)}
    end
  end

  defp apply_all(services, runtime_fun) do
    Enum.reduce_while(services, :ok, fn service, :ok ->
      case runtime_fun.(service) do
        :ok -> {:cont, :ok}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end

  defp record_activity(cell_id, service_id, type, audit, metadata) do
    attrs =
      %{
        cell_id: cell_id,
        type: type,
        source: Map.get(audit, :source),
        tool_name: Map.get(audit, :tool_name),
        metadata: merge_audit_metadata(audit, metadata || %{})
      }
      |> maybe_put_service_id(service_id)

    case Ash.create(Activity, attrs) do
      {:ok, _activity} -> :ok
      {:error, _error} -> :ok
    end
  end

  defp merge_audit_metadata(audit, metadata) when is_map(metadata) do
    metadata
    |> maybe_put_metadata("auditEvent", Map.get(audit, :audit_event))
    |> maybe_put_metadata("serviceName", Map.get(audit, :service_name))
  end

  defp maybe_put_service_id(attrs, nil), do: attrs
  defp maybe_put_service_id(attrs, service_id), do: Map.put(attrs, :service_id, service_id)

  defp ensure_runtime_start(service) do
    case ServiceRuntime.start_service(service) do
      :ok -> :ok
      {:error, _reason} -> {:error, :service_runtime_unavailable}
    end
  end

  defp ensure_runtime_stop(service) do
    case ServiceRuntime.stop_service(service) do
      :ok -> :ok
      {:error, _reason} -> {:error, :service_runtime_unavailable}
    end
  end

  defp ensure_runtime_restart(service) do
    case ServiceRuntime.restart_service(service) do
      :ok -> :ok
      {:error, _reason} -> {:error, :service_runtime_unavailable}
    end
  end

  defp maybe_put_metadata(metadata, _key, nil), do: metadata
  defp maybe_put_metadata(metadata, key, value), do: Map.put(metadata, key, value)

  defp maybe_to_iso8601(nil), do: nil
  defp maybe_to_iso8601(datetime), do: DateTime.to_iso8601(datetime)

  defp process_unavailable_reason(pid, _process_alive) when not is_integer(pid), do: "pid_missing"
  defp process_unavailable_reason(_pid, false), do: "process_not_alive"
  defp process_unavailable_reason(_pid, true), do: "sample_failed"

  defp reconcile_runtime_state(changeset) do
    case normalize_status(Ash.Changeset.get_argument_or_attribute(changeset, :status)) do
      :running ->
        changeset
        |> Ash.Changeset.force_change_attribute(:status, :running)
        |> Ash.Changeset.force_change_attribute(
          :pid,
          Ash.Changeset.get_argument_or_attribute(changeset, :pid)
        )
        |> maybe_force_attribute(:port, Ash.Changeset.get_argument_or_attribute(changeset, :port))
        |> Ash.Changeset.force_change_attribute(:last_known_error, nil)

      :stopped ->
        changeset
        |> Ash.Changeset.force_change_attribute(:status, :stopped)
        |> Ash.Changeset.force_change_attribute(:pid, nil)
        |> maybe_force_attribute(:port, Ash.Changeset.get_argument_or_attribute(changeset, :port))
        |> Ash.Changeset.force_change_attribute(:last_known_error, nil)

      :error ->
        changeset
        |> Ash.Changeset.force_change_attribute(:status, :error)
        |> Ash.Changeset.force_change_attribute(:pid, nil)
        |> maybe_force_attribute(:port, Ash.Changeset.get_argument_or_attribute(changeset, :port))
        |> Ash.Changeset.force_change_attribute(
          :last_known_error,
          Ash.Changeset.get_argument_or_attribute(changeset, :last_known_error)
        )

      _other ->
        Ash.Changeset.add_error(
          changeset,
          field: :status,
          message: "must be a valid reconciled service status"
        )
    end
  end

  defp maybe_force_attribute(changeset, _attribute, nil), do: changeset

  defp maybe_force_attribute(changeset, attribute, value) do
    Ash.Changeset.force_change_attribute(changeset, attribute, value)
  end

  defp format_status(status) when is_atom(status), do: Atom.to_string(status)
  defp format_status(status) when is_binary(status), do: status
  defp format_status(_status), do: "unknown"
end

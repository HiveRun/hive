defmodule HiveServerElixir.Cells.Cell do
  @moduledoc false

  import Ash.Expr
  require Ash.Query

  alias HiveServerElixir.Cells.AgentSession
  alias HiveServerElixir.Cells.CellCommands
  alias HiveServerElixir.Cells.CellStatus
  alias HiveServerElixir.Cells.Events
  alias HiveServerElixir.Cells.Provisioning
  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.ServicePayload
  alias HiveServerElixir.Cells.TerminalEvents
  alias HiveServerElixir.Cells.Workspace

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

  @allowed_lifecycle_sources %{
    provisioning: [:provisioning, :stopped, :ready, :error],
    ready: [:provisioning, :stopped, :ready],
    error: [:provisioning, :error]
  }

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
        create_payload(input.arguments)
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
        retry_setup_payload(input.arguments)
      end
    end

    action :resume_cell_setup, :map do
      constraints fields: @cell_payload_fields

      argument :cell_id, :uuid do
        allow_nil? false
        public? true
      end

      run fn input, _context ->
        resume_setup_payload(input.arguments)
      end
    end

    action :delete_cell, :map do
      constraints fields: @delete_payload_fields

      argument :cell_id, :uuid do
        allow_nil? false
        public? true
      end

      run fn input, _context ->
        delete_payload(input.arguments)
      end
    end

    action :delete_many_cells, :map do
      constraints fields: @delete_many_payload_fields

      argument :ids, {:array, :uuid} do
        allow_nil? false
        public? true
      end

      run fn input, _context ->
        delete_many_payload(input.arguments)
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
        Service.list_payloads(Map.fetch!(input.arguments, :cell_id), input.arguments)
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
        Service.start_all_payloads(Map.fetch!(input.arguments, :cell_id), input.arguments)
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
        Service.stop_all_payloads(Map.fetch!(input.arguments, :cell_id), input.arguments)
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
        Service.restart_all_payloads(Map.fetch!(input.arguments, :cell_id), input.arguments)
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
        :last_setup_error,
        :branch_name,
        :base_commit
      ]
    end

    update :begin_provisioning do
      accept []
      require_atomic? false

      change fn changeset, _context ->
        changeset
        |> validate_lifecycle_transition(:provisioning)
        |> Ash.Changeset.force_change_attribute(:status, :provisioning)
        |> Ash.Changeset.force_change_attribute(:last_setup_error, nil)
      end
    end

    update :prepare_setup_attempt do
      accept [:opencode_session_id]
      require_atomic? false

      argument :start_mode, :string do
        allow_nil? true
      end

      validate one_of(:start_mode, ["plan", "build"])

      change fn changeset, _context ->
        session_id = resolve_setup_session_id(changeset)

        changeset
        |> validate_lifecycle_transition(:provisioning)
        |> Ash.Changeset.force_change_attribute(:status, :provisioning)
        |> Ash.Changeset.force_change_attribute(:last_setup_error, nil)
        |> Ash.Changeset.force_change_attribute(:resume_agent_session_on_startup, true)
        |> Ash.Changeset.force_change_attribute(:opencode_session_id, session_id)
        |> Ash.Changeset.after_action(fn changeset, cell ->
          case ensure_setup_records(cell, Ash.Changeset.get_argument(changeset, :start_mode)) do
            :ok -> {:ok, cell}
            {:error, error} -> {:error, error}
          end
        end)
      end
    end

    update :mark_ready do
      accept []
      require_atomic? false

      change fn changeset, _context ->
        changeset
        |> validate_lifecycle_transition(:ready)
        |> Ash.Changeset.force_change_attribute(:status, :ready)
        |> Ash.Changeset.force_change_attribute(:last_setup_error, nil)
      end
    end

    update :mark_error do
      accept [:last_setup_error]
      require_atomic? false

      change fn changeset, _context ->
        changeset
        |> validate_lifecycle_transition(:error)
        |> Ash.Changeset.force_change_attribute(:status, :error)
      end
    end

    update :finalize_setup_attempt do
      accept [:last_setup_error]
      require_atomic? false

      argument :result, :string do
        allow_nil? false
      end

      validate one_of(:result, ["ready", "error"])

      change fn changeset, _context ->
        changeset
        |> apply_setup_result()
        |> Ash.Changeset.after_action(fn _changeset, cell ->
          case finish_setup_attempt(cell.id) do
            :ok -> {:ok, cell}
            {:error, error} -> {:error, error}
          end
        end)
      end
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

  @spec create_payload(map()) :: {:ok, map()} | {:error, term()}
  def create_payload(input) when is_map(input) do
    workspace_id = Map.fetch!(input, :workspace_id)
    description = Map.get(input, :description)

    with {:ok, workspace} <- Ash.get(Workspace, workspace_id),
         {:ok, cell} <-
           CellCommands.create(%{
             workspace_id: workspace_id,
             name: normalize_cell_name(Map.get(input, :name), description),
             description: description,
             template_id: normalize_template_id(Map.get(input, :template_id)),
             start_mode: normalize_start_mode(Map.get(input, :start_mode)),
             workspace_root_path: workspace.path,
             workspace_path: workspace.path,
             runtime_opts: reactor_runtime_opts(),
             fail_after_ingest: false
           }),
         :ok <- Events.publish_cell_status(cell.workspace_id, cell.id) do
      {:ok, rpc_payload(cell)}
    end
  end

  @spec retry_setup_payload(map()) :: {:ok, map()} | {:error, term()}
  def retry_setup_payload(input) when is_map(input) do
    with {:ok, cell} <-
           CellCommands.retry(%{
             cell_id: Map.fetch!(input, :cell_id),
             runtime_opts: reactor_runtime_opts(),
             fail_after_ingest: false
           }),
         :ok <- record_retry_activity(cell.id, input),
         :ok <- Events.publish_cell_status(cell.workspace_id, cell.id) do
      {:ok, rpc_payload(cell)}
    end
  end

  @spec resume_setup_payload(map()) :: {:ok, map()} | {:error, term()}
  def resume_setup_payload(input) when is_map(input) do
    with {:ok, cell} <-
           CellCommands.resume(%{
             cell_id: Map.fetch!(input, :cell_id),
             runtime_opts: reactor_runtime_opts(),
             fail_after_ingest: false
           }),
         :ok <- Events.publish_cell_status(cell.workspace_id, cell.id) do
      {:ok, rpc_payload(cell)}
    end
  end

  @spec delete_payload(map()) :: {:ok, map()} | {:error, term()}
  def delete_payload(input) when is_map(input) do
    with {:ok, cell} <-
           CellCommands.delete(%{
             cell_id: Map.fetch!(input, :cell_id),
             runtime_opts: reactor_runtime_opts(),
             fail_after_stop: false
           }),
         :ok <- Events.publish_cell_removed(cell.workspace_id, cell.id) do
      {:ok, %{deleted_id: cell.id, workspace_id: cell.workspace_id}}
    end
  end

  @spec delete_many_payload(map()) :: {:ok, map()}
  def delete_many_payload(input) when is_map(input) do
    ids =
      input
      |> Map.get(:ids, [])
      |> Enum.uniq()

    {deleted_ids, failed_ids} =
      Enum.reduce(ids, {[], []}, fn id, {deleted_ids, failed_ids} ->
        case delete_payload(%{cell_id: id}) do
          {:ok, %{deleted_id: deleted_id}} -> {[deleted_id | deleted_ids], failed_ids}
          {:error, _error} -> {deleted_ids, [id | failed_ids]}
        end
      end)

    {:ok, %{deleted_ids: Enum.reverse(deleted_ids), failed_ids: Enum.reverse(failed_ids)}}
  end

  @spec ingest_context(map()) :: map()
  def ingest_context(%{workspace_id: workspace_id, id: cell_id}) do
    %{workspace_id: workspace_id, cell_id: cell_id}
  end

  @spec finalize_template_runtime(map(), map()) :: {:ok, map()} | {:error, term()}
  def finalize_template_runtime(cell, %{status: "ready"}) do
    finalize_setup_result(cell, %{result: "ready"})
  end

  def finalize_template_runtime(cell, %{status: "error", last_setup_error: last_setup_error}) do
    finalize_setup_result(cell, %{last_setup_error: last_setup_error, result: "error"})
  end

  @spec finalize_setup_error(map() | String.t(), term()) :: :ok | {:error, term()}
  def finalize_setup_error(%{id: cell_id}, reason), do: finalize_setup_error(cell_id, reason)

  def finalize_setup_error(cell_id, reason) when is_binary(cell_id) do
    with {:ok, cell} <- Ash.get(__MODULE__, cell_id) do
      finalize_setup_error(cell, reason, cell_id)
    end
  end

  @spec rpc_payload(map()) :: map()
  def rpc_payload(cell) when is_map(cell) do
    cell_payload_fields(cell)
  end

  @spec transport_payload(map(), keyword()) :: map()
  def transport_payload(cell, opts \\ []) when is_map(cell) do
    payload = cell_payload_fields(cell)
    workspace_path = Keyword.get(opts, :workspace_path)

    %{
      id: payload.id,
      name: payload.name,
      workspaceId: payload.workspace_id,
      description: payload.description,
      templateId: payload.template_id,
      workspaceRootPath: present_or_fallback(payload.workspace_root_path, workspace_path),
      workspacePath: present_or_fallback(payload.workspace_path, workspace_path),
      opencodeSessionId: payload.opencode_session_id,
      opencodeCommand: payload.opencode_command,
      createdAt: payload.created_at,
      status: payload.status,
      lastSetupError: payload.last_setup_error,
      branchName: payload.branch_name,
      baseCommit: payload.base_commit,
      updatedAt: payload.updated_at
    }
  end

  @spec emit_terminal_state(map()) :: :ok
  def emit_terminal_state(%{workspace_id: workspace_id, id: cell_id} = cell) do
    cond do
      CellStatus.ready?(cell) ->
        TerminalEvents.on_cell_ready(%{workspace_id: workspace_id, cell_id: cell_id})

      CellStatus.error?(cell) and is_binary(cell.last_setup_error) and cell.last_setup_error != "" ->
        TerminalEvents.on_cell_error(
          %{workspace_id: workspace_id, cell_id: cell_id},
          cell.last_setup_error
        )

      true ->
        :ok
    end
  end

  defp ensure_default_attribute(changeset, attribute, default_value) do
    case Ash.Changeset.get_attribute(changeset, attribute) do
      nil -> Ash.Changeset.force_change_attribute(changeset, attribute, default_value)
      _value -> changeset
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
          "cannot transition cell status from #{format_status(current_status)} to #{format_status(target_status)}"
      )
    end
  end

  defp finalize_setup_error(%{status: status}, _reason, _cell_id)
       when status not in [:provisioning, "provisioning"] do
    :ok
  end

  defp finalize_setup_error(cell, reason, _cell_id) do
    case finalize_setup_result(cell, %{last_setup_error: format_reason(reason), result: "error"}) do
      {:ok, _updated_cell} -> :ok
      {:error, error} -> {:error, error}
    end
  end

  defp apply_setup_result(changeset) do
    case Ash.Changeset.get_argument(changeset, :result) do
      "ready" ->
        changeset
        |> validate_lifecycle_transition(:ready)
        |> Ash.Changeset.force_change_attribute(:status, :ready)
        |> Ash.Changeset.force_change_attribute(:last_setup_error, nil)

      "error" ->
        changeset
        |> validate_lifecycle_transition(:error)
        |> Ash.Changeset.force_change_attribute(:status, :error)

      _other ->
        changeset
    end
  end

  defp finalize_setup_result(cell, attrs) do
    cell
    |> Ash.Changeset.for_update(:finalize_setup_attempt, attrs)
    |> Ash.update()
  end

  defp resolve_setup_session_id(changeset) do
    Ash.Changeset.get_attribute(changeset, :opencode_session_id) ||
      Ash.Changeset.get_data(changeset, :opencode_session_id) ||
      existing_session_id(changeset) ||
      Ash.UUID.generate()
  end

  defp existing_session_id(changeset) do
    case Ash.Changeset.get_data(changeset, :id) do
      nil -> nil
      cell_id -> existing_session_id_for_cell(cell_id)
    end
  end

  defp existing_session_id_for_cell(cell_id) do
    case AgentSession.fetch_for_cell(cell_id) do
      %AgentSession{session_id: session_id} when is_binary(session_id) and session_id != "" ->
        session_id

      _other ->
        nil
    end
  end

  defp ensure_setup_records(cell, start_mode) do
    with :ok <- ensure_provisioning_attempt(cell.id, start_mode),
         :ok <- ensure_agent_session(cell, start_mode) do
      :ok
    end
  end

  defp ensure_provisioning_attempt(cell_id, start_mode) do
    attrs = %{start_mode: normalize_start_mode(start_mode)}

    case Provisioning.fetch_for_cell(cell_id) do
      %Provisioning{} = provisioning ->
        case Ash.update(provisioning, attrs, action: :begin_attempt) do
          {:ok, _updated} -> :ok
          {:error, error} -> {:error, error}
        end

      nil ->
        case Ash.create(Provisioning, Map.put(attrs, :cell_id, cell_id),
               action: :begin_attempt_record
             ) do
          {:ok, _created} -> :ok
          {:error, error} -> {:error, error}
        end
    end
  end

  defp ensure_agent_session(cell, start_mode) when is_map(cell) do
    session_id =
      cell.opencode_session_id || existing_session_id_for_cell(cell.id) || Ash.UUID.generate()

    case AgentSession.fetch_by_session_id(session_id) || AgentSession.fetch_for_cell(cell.id) do
      %AgentSession{} = session ->
        case Ash.update(session, %{resume_on_startup: true}, action: :sync_runtime_details) do
          {:ok, _updated} -> :ok
          {:error, error} -> {:error, error}
        end

      nil ->
        mode = normalize_start_mode(start_mode)

        case Ash.create(
               AgentSession,
               %{
                 cell_id: cell.id,
                 session_id: session_id,
                 start_mode: mode,
                 current_mode: mode,
                 resume_on_startup: true
               },
               action: :begin_session
             ) do
          {:ok, _created} -> :ok
          {:error, error} -> {:error, error}
        end
    end
  end

  defp finish_setup_attempt(cell_id) do
    case Provisioning.fetch_for_cell(cell_id) do
      %Provisioning{} = provisioning ->
        case Ash.update(provisioning, %{}, action: :finish_attempt) do
          {:ok, _updated} -> :ok
          {:error, error} -> {:error, error}
        end

      nil ->
        :ok
    end
  end

  defp normalize_start_mode("build"), do: "build"
  defp normalize_start_mode("plan"), do: "plan"
  defp normalize_start_mode(_mode), do: "plan"

  defp normalize_cell_name(name, _description) when is_binary(name) and byte_size(name) > 0,
    do: name

  defp normalize_cell_name(_name, description)
       when is_binary(description) and byte_size(description) > 0,
       do: description

  defp normalize_cell_name(_name, _description), do: "Cell"

  defp normalize_template_id(template_id)
       when is_binary(template_id) and byte_size(template_id) > 0,
       do: template_id

  defp normalize_template_id(_template_id), do: "default-template"

  defp format_reason(reason) when is_binary(reason), do: reason
  defp format_reason(reason) when is_atom(reason), do: Atom.to_string(reason)
  defp format_reason(reason), do: inspect(reason)

  defp reactor_runtime_opts do
    Application.get_env(:hive_server_elixir, :cell_reactor_runtime_opts, [])
  end

  defp record_retry_activity(cell_id, input) do
    attrs = %{
      cell_id: cell_id,
      type: "setup.retry",
      source: Map.get(input, :source),
      tool_name: Map.get(input, :tool_name),
      metadata:
        %{}
        |> maybe_put_metadata("auditEvent", Map.get(input, :audit_event))
        |> maybe_put_metadata("serviceName", Map.get(input, :service_name))
    }

    case Ash.create(HiveServerElixir.Cells.Activity, attrs) do
      {:ok, _activity} -> :ok
      {:error, _error} -> :ok
    end
  end

  defp maybe_put_metadata(metadata, _key, nil), do: metadata
  defp maybe_put_metadata(metadata, key, value), do: Map.put(metadata, key, value)

  defp cell_payload_fields(cell) do
    %{
      id: cell.id,
      name: cell.name,
      workspace_id: cell.workspace_id,
      description: cell.description,
      template_id: cell.template_id,
      workspace_root_path: cell.workspace_root_path,
      workspace_path: cell.workspace_path,
      opencode_session_id: cell.opencode_session_id,
      opencode_command: build_opencode_command(cell.workspace_path, cell.opencode_session_id),
      created_at: maybe_to_iso8601(cell.inserted_at),
      status: CellStatus.present(cell.status),
      last_setup_error: cell.last_setup_error,
      branch_name: cell.branch_name,
      base_commit: cell.base_commit,
      updated_at: maybe_to_iso8601(cell.updated_at)
    }
  end

  defp present_or_fallback(value, _fallback) when is_binary(value) and byte_size(value) > 0,
    do: value

  defp present_or_fallback(_value, fallback), do: fallback

  defp build_opencode_command(workspace_path, session_id)
       when is_binary(workspace_path) and workspace_path != "" and is_binary(session_id) and
              session_id != "" do
    "opencode \"" <> workspace_path <> "\" --session \"" <> session_id <> "\""
  end

  defp build_opencode_command(_workspace_path, _session_id), do: nil

  defp maybe_to_iso8601(%DateTime{} = value), do: DateTime.to_iso8601(value)
  defp maybe_to_iso8601(%NaiveDateTime{} = value), do: NaiveDateTime.to_iso8601(value)
  defp maybe_to_iso8601(value) when is_binary(value), do: value
  defp maybe_to_iso8601(_value), do: nil

  defp normalize_status(status) when is_binary(status) do
    case CellStatus.cast_input(status, []) do
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

defmodule HiveServerElixir.Cells.Cell do
  @moduledoc false

  import Ash.Expr
  require Ash.Query

  alias HiveServerElixir.Cells.AgentSession
  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.CellStatus
  alias HiveServerElixir.Cells.Provisioning
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
    case agent_session_for_cell(cell_id) do
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
    attrs = maybe_put(%{}, :start_mode, normalize_start_mode(start_mode))

    case provisioning_for_cell(cell_id) do
      %Provisioning{} = provisioning ->
        case Ash.update(provisioning, attrs, action: :begin_attempt, domain: Cells) do
          {:ok, _updated} -> :ok
          {:error, error} -> {:error, error}
        end

      nil ->
        case Ash.create(
               Provisioning,
               Map.put(attrs, :cell_id, cell_id),
               action: :begin_attempt_record,
               domain: Cells
             ) do
          {:ok, _created} -> :ok
          {:error, error} -> {:error, error}
        end
    end
  end

  defp ensure_agent_session(cell, start_mode) when is_map(cell) do
    session_id =
      cell.opencode_session_id || existing_session_id_for_cell(cell.id) || Ash.UUID.generate()

    case session_by_session_id(session_id) || agent_session_for_cell(cell.id) do
      %AgentSession{} = session ->
        case Ash.update(
               session,
               %{resume_on_startup: true},
               action: :sync_runtime_details,
               domain: Cells
             ) do
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
               action: :begin_session,
               domain: Cells
             ) do
          {:ok, _created} -> :ok
          {:error, error} -> {:error, error}
        end
    end
  end

  defp finish_setup_attempt(cell_id) do
    case provisioning_for_cell(cell_id) do
      %Provisioning{} = provisioning ->
        case Ash.update(provisioning, %{}, action: :finish_attempt, domain: Cells) do
          {:ok, _updated} -> :ok
          {:error, error} -> {:error, error}
        end

      nil ->
        :ok
    end
  end

  defp provisioning_for_cell(cell_id) do
    Provisioning
    |> Ash.Query.filter(expr(cell_id == ^cell_id))
    |> Ash.read_one!(domain: Cells)
  end

  defp agent_session_for_cell(cell_id) do
    AgentSession
    |> Ash.Query.filter(expr(cell_id == ^cell_id))
    |> Ash.read_one!(domain: Cells)
  end

  defp session_by_session_id(session_id) do
    AgentSession
    |> Ash.Query.filter(expr(session_id == ^session_id))
    |> Ash.read_one!(domain: Cells)
  end

  defp normalize_start_mode("build"), do: "build"
  defp normalize_start_mode("plan"), do: "plan"
  defp normalize_start_mode(_mode), do: nil

  defp maybe_put(attrs, _key, nil), do: attrs
  defp maybe_put(attrs, key, value), do: Map.put(attrs, key, value)

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

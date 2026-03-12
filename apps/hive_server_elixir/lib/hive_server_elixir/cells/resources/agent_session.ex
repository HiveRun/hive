defmodule HiveServerElixir.Cells.AgentSession do
  @moduledoc false

  import Ash.Expr
  require Ash.Query

  alias HiveServerElixir.Cells.AgentSessionRead
  alias HiveServerElixir.Cells

  use Ash.Resource,
    extensions: [AshTypescript.Resource],
    domain: HiveServerElixir.Cells,
    data_layer: AshSqlite.DataLayer

  @allowed_modes ["plan", "build"]

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

    create :begin_session do
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

      change fn changeset, _context ->
        initialize_modes(changeset)
      end
    end

    update :set_mode do
      require_atomic? false

      argument :mode, :string do
        allow_nil? false
      end

      validate one_of(:mode, @allowed_modes)

      change fn changeset, _context ->
        mode = Ash.Changeset.get_argument(changeset, :mode)

        changeset
        |> Ash.Changeset.force_change_attribute(:current_mode, mode)
        |> Ash.Changeset.force_change_attribute(:last_error, nil)
      end
    end

    update :sync_runtime_details do
      require_atomic? false
      accept [:model_id, :model_provider_id, :resume_on_startup]
    end

    update :record_error do
      require_atomic? false
      accept [:last_error]
    end

    action :get_session_by_cell, :map do
      constraints fields: @session_payload_fields

      argument :cell_id, :uuid do
        allow_nil? false
        public? true
      end

      run fn input, _context ->
        case payload_for_cell(input.arguments.cell_id) do
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

      validate one_of(:mode, @allowed_modes)

      run fn input, _context ->
        case set_mode_payload(input.arguments.session_id, input.arguments.mode) do
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

  defp initialize_modes(changeset) do
    start_mode = Ash.Changeset.get_attribute(changeset, :start_mode)
    current_mode = Ash.Changeset.get_attribute(changeset, :current_mode)

    with {:ok, normalized_start_mode} <- normalize_mode(:start_mode, start_mode, default: "plan"),
         {:ok, normalized_current_mode} <-
           normalize_mode(:current_mode, current_mode, default: normalized_start_mode) do
      changeset
      |> Ash.Changeset.force_change_attribute(:start_mode, normalized_start_mode)
      |> Ash.Changeset.force_change_attribute(:current_mode, normalized_current_mode)
    else
      {:error, {field, message}} ->
        Ash.Changeset.add_error(changeset, field: field, message: message)
    end
  end

  defp normalize_mode(_field, nil, opts), do: {:ok, Keyword.fetch!(opts, :default)}

  defp normalize_mode(field, mode, opts) when is_binary(mode) do
    normalized_mode = String.trim(mode)

    cond do
      normalized_mode == "" -> {:ok, Keyword.fetch!(opts, :default)}
      normalized_mode in @allowed_modes -> {:ok, normalized_mode}
      true -> {:error, {field, "must be either 'plan' or 'build'"}}
    end
  end

  defp normalize_mode(field, _mode, _opts),
    do: {:error, {field, "must be either 'plan' or 'build'"}}

  @spec payload_for_cell(String.t()) :: {:ok, map() | nil} | {:error, {atom(), String.t()}}
  def payload_for_cell(cell_id) when is_binary(cell_id) do
    AgentSessionRead.payload_for_cell(cell_id)
  end

  @spec fetch_for_cell(String.t()) :: t() | nil
  def fetch_for_cell(cell_id) when is_binary(cell_id) do
    __MODULE__
    |> Ash.Query.filter(expr(cell_id == ^cell_id))
    |> Ash.read_one(domain: Cells)
    |> case do
      {:ok, session} -> session
      {:error, _reason} -> nil
    end
  end

  @spec fetch_by_session_id(String.t()) :: t() | nil
  def fetch_by_session_id(session_id) when is_binary(session_id) do
    __MODULE__
    |> Ash.Query.filter(expr(session_id == ^session_id))
    |> Ash.read_one(domain: Cells)
    |> case do
      {:ok, session} -> session
      {:error, _reason} -> nil
    end
  end

  @spec event_snapshot_for_session(String.t()) :: {:ok, map()} | {:error, {atom(), String.t()}}
  def event_snapshot_for_session(session_id) when is_binary(session_id) do
    AgentSessionRead.snapshot_for_session(session_id)
  end

  @spec set_mode_payload(String.t(), String.t()) :: {:ok, map()} | {:error, {atom(), String.t()}}
  def set_mode_payload(session_id, mode) when is_binary(session_id) and is_binary(mode) do
    normalized_mode = normalize_mode(mode)

    if normalized_mode in @allowed_modes do
      with {:ok, context} <- AgentSessionRead.context_for_session(session_id),
           {:ok, agent_session} <- resolve_persisted_session(context),
           {:ok, updated_session} <-
             Ash.update(agent_session, %{mode: normalized_mode}, action: :set_mode, domain: Cells) do
        updated_context = %{context | agent_session: updated_session}
        {:ok, AgentSessionRead.payload_from_context(updated_context)}
      else
        {:error, {_, _} = reason} -> {:error, reason}
        {:error, _error} -> {:error, {:bad_request, "Failed to update session mode"}}
      end
    else
      {:error, {:bad_request, "mode must be either 'plan' or 'build'"}}
    end
  end

  defp normalize_mode("plan"), do: "plan"
  defp normalize_mode("build"), do: "build"
  defp normalize_mode(_mode), do: nil

  defp resolve_persisted_session(%{agent_session: session}) when not is_nil(session),
    do: {:ok, session}

  defp resolve_persisted_session(_context), do: {:error, {:not_found, "Agent session not found"}}

  @spec snapshot_payload(t() | nil) :: map() | nil
  def snapshot_payload(nil), do: nil

  def snapshot_payload(session) when is_map(session) do
    %{
      id: session.id,
      cellId: session.cell_id,
      sessionId: session.session_id,
      currentMode: session.current_mode,
      modelId: session.model_id,
      modelProviderId: session.model_provider_id,
      lastError: session.last_error,
      insertedAt: maybe_to_iso8601(session.inserted_at),
      updatedAt: maybe_to_iso8601(session.updated_at)
    }
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

  defp maybe_to_iso8601(nil), do: nil
  defp maybe_to_iso8601(datetime), do: DateTime.to_iso8601(datetime)
end

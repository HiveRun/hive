defmodule HiveServerElixir.Cells.Timing do
  @moduledoc false

  import Ash.Expr
  require Ash.Query

  use Ash.Resource,
    extensions: [AshTypescript.Resource],
    domain: HiveServerElixir.Cells,
    data_layer: AshSqlite.DataLayer

  typescript do
    type_name "Timing"
  end

  sqlite do
    table "cell_timing_events"
    repo HiveServerElixir.Repo
  end

  actions do
    defaults [:read, :destroy]

    read :for_cell do
      argument :cell_id, :uuid do
        allow_nil? false
        public? true
      end

      argument :limit, :integer do
        allow_nil? true
        public? true
      end

      argument :workflow, :string do
        allow_nil? true
        public? true
      end

      argument :run_id, :string do
        allow_nil? true
        public? true
      end

      prepare build(sort: [inserted_at: :desc, id: :desc])

      prepare fn query, _context ->
        _limit = min(max(Ash.Query.get_argument(query, :limit) || 50, 1), 1_000)
        Ash.Query.limit(query, 1_000)
      end

      filter expr(
               cell_id == ^arg(:cell_id) and
                 (is_nil(^arg(:workflow)) or workflow == ^arg(:workflow)) and
                 (is_nil(^arg(:run_id)) or run_id == ^arg(:run_id))
             )
    end

    read :global do
      argument :cell_id, :uuid do
        allow_nil? true
        public? true
      end

      argument :workspace_id, :uuid do
        allow_nil? true
        public? true
      end

      argument :limit, :integer do
        allow_nil? true
        public? true
      end

      argument :workflow, :string do
        allow_nil? true
        public? true
      end

      argument :run_id, :string do
        allow_nil? true
        public? true
      end

      prepare build(sort: [inserted_at: :desc, id: :desc])

      prepare fn query, _context ->
        _limit = min(max(Ash.Query.get_argument(query, :limit) || 50, 1), 1_000)
        Ash.Query.limit(query, 1_000)
      end

      filter expr(
               (is_nil(^arg(:cell_id)) or cell_id == ^arg(:cell_id)) and
                 (is_nil(^arg(:workspace_id)) or workspace_id == ^arg(:workspace_id)) and
                 (is_nil(^arg(:workflow)) or workflow == ^arg(:workflow)) and
                 (is_nil(^arg(:run_id)) or run_id == ^arg(:run_id))
             )
    end

    create :create do
      primary? true

      accept [
        :cell_id,
        :cell_name,
        :workspace_id,
        :template_id,
        :workflow,
        :run_id,
        :step,
        :status,
        :duration_ms,
        :attempt,
        :error,
        :metadata
      ]
    end
  end

  attributes do
    uuid_primary_key :id

    attribute :cell_name, :string do
      allow_nil? true
      public? true
    end

    attribute :workspace_id, :uuid do
      allow_nil? true
      public? true
    end

    attribute :template_id, :string do
      allow_nil? true
      public? true
    end

    attribute :workflow, :string do
      allow_nil? false
      public? true
    end

    attribute :run_id, :string do
      allow_nil? false
      public? true
    end

    attribute :step, :string do
      allow_nil? false
      public? true
    end

    attribute :status, :string do
      allow_nil? false
      public? true
    end

    attribute :duration_ms, :integer do
      allow_nil? false
      public? true
    end

    attribute :attempt, :integer do
      allow_nil? true
      public? true
    end

    attribute :error, :string do
      allow_nil? true
      public? true
    end

    attribute :metadata, :map do
      allow_nil? false
      public? true
      default %{}
    end

    create_timestamp :inserted_at, public?: true
  end

  relationships do
    belongs_to :cell, HiveServerElixir.Cells.Cell do
      allow_nil? true
      public? true
      attribute_writable? true
    end
  end

  @spec latest_for_cell(String.t()) :: t() | nil
  def latest_for_cell(cell_id) when is_binary(cell_id) do
    __MODULE__
    |> Ash.Query.filter(expr(cell_id == ^cell_id))
    |> Ash.Query.sort(inserted_at: :desc, id: :desc)
    |> Ash.Query.limit(1)
    |> Ash.read()
    |> case do
      {:ok, [timing | _]} -> timing
      {:ok, []} -> nil
      {:error, _reason} -> nil
    end
  end

  @spec snapshot_payload(t() | nil) :: map() | nil
  def snapshot_payload(nil), do: nil

  def snapshot_payload(timing) when is_map(timing) do
    %{
      id: timing.id,
      cellId: timing.cell_id,
      cellName: timing.cell_name,
      workspaceId: timing.workspace_id,
      templateId: timing.template_id,
      runId: timing.run_id,
      workflow: timing.workflow,
      step: timing.step,
      status: timing.status,
      attempt: timing.attempt,
      error: timing.error,
      metadata: timing.metadata,
      durationMs: timing.duration_ms,
      createdAt: maybe_to_iso8601(timing.inserted_at)
    }
  end

  defp maybe_to_iso8601(nil), do: nil
  defp maybe_to_iso8601(datetime), do: DateTime.to_iso8601(datetime)
end

defmodule HiveServerElixir.Cells.Activity do
  @moduledoc false

  import Ash.Expr
  require Ash.Query

  use Ash.Resource,
    extensions: [AshTypescript.Resource],
    domain: HiveServerElixir.Cells,
    data_layer: AshSqlite.DataLayer

  typescript do
    type_name "Activity"
  end

  sqlite do
    table "cell_activity_events"
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

      argument :cursor_created_at, :utc_datetime_usec do
        allow_nil? true
        public? true
      end

      argument :cursor_id, :uuid do
        allow_nil? true
        public? true
      end

      argument :types, {:array, :string} do
        allow_nil? true
        public? true
      end

      prepare build(sort: [inserted_at: :desc, id: :desc])

      prepare fn query, _context ->
        limit = min(max(Ash.Query.get_argument(query, :limit) || 50, 1), 200)
        Ash.Query.limit(query, limit + 1)
      end

      filter expr(
               cell_id == ^arg(:cell_id) and
                 (is_nil(^arg(:cursor_created_at)) or inserted_at < ^arg(:cursor_created_at) or
                    (inserted_at == ^arg(:cursor_created_at) and id < ^arg(:cursor_id))) and
                 (is_nil(^arg(:types)) or type in ^arg(:types))
             )
    end

    create :create do
      primary? true
      accept [:cell_id, :service_id, :type, :source, :tool_name, :metadata]
    end
  end

  attributes do
    uuid_primary_key :id

    attribute :type, :string do
      allow_nil? false
      public? true
    end

    attribute :source, :string do
      allow_nil? true
      public? true
    end

    attribute :tool_name, :string do
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
      allow_nil? false
      public? true
      attribute_writable? true
    end

    belongs_to :service, HiveServerElixir.Cells.Service do
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
      {:ok, [activity | _]} -> activity
      {:ok, []} -> nil
      {:error, _reason} -> nil
    end
  end

  @spec snapshot_payload(t() | nil) :: map() | nil
  def snapshot_payload(nil), do: nil

  def snapshot_payload(activity) when is_map(activity) do
    %{
      id: activity.id,
      cellId: activity.cell_id,
      serviceId: activity.service_id,
      type: activity.type,
      source: activity.source,
      toolName: activity.tool_name,
      metadata: activity.metadata,
      createdAt: maybe_to_iso8601(activity.inserted_at)
    }
  end

  defp maybe_to_iso8601(nil), do: nil
  defp maybe_to_iso8601(datetime), do: DateTime.to_iso8601(datetime)
end

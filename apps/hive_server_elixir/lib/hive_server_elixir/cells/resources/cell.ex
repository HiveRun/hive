defmodule HiveServerElixir.Cells.Cell do
  @moduledoc false

  alias HiveServerElixir.Cells.CellStatus

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

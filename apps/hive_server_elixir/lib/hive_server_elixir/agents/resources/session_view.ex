defmodule HiveServerElixir.Agents.SessionView do
  @moduledoc false

  alias HiveServerElixir.Agents.Support.SessionViewBuilder

  use Ash.Resource, domain: HiveServerElixir.Agents

  actions do
    defaults []

    action :for_cell, :map do
      argument :cell_id, :uuid do
        allow_nil? false
        public? true
      end

      run fn input, _context ->
        SessionViewBuilder.for_cell(input.arguments.cell_id)
      end
    end

    action :messages_for_session, :map do
      argument :session_id, :string do
        allow_nil? false
        public? true
      end

      run fn input, _context ->
        SessionViewBuilder.messages_for_session(input.arguments.session_id)
      end
    end

    action :event_snapshot_for_session, :map do
      argument :session_id, :string do
        allow_nil? false
        public? true
      end

      run fn input, _context ->
        SessionViewBuilder.event_snapshot_for_session(input.arguments.session_id)
      end
    end
  end
end

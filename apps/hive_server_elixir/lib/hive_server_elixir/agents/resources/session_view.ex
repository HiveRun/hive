defmodule HiveServerElixir.Agents.SessionView do
  @moduledoc false

  alias HiveServerElixir.Agents.Support.SessionMessagesLoader
  alias HiveServerElixir.Cells.AgentSessionRead

  use Ash.Resource, domain: HiveServerElixir.Agents

  actions do
    defaults []

    action :for_cell, :map do
      argument :cell_id, :uuid do
        allow_nil? false
        public? true
      end

      run fn input, _context ->
        AgentSessionRead.payload_for_cell(input.arguments.cell_id)
      end
    end

    action :messages_for_session, :map do
      argument :session_id, :string do
        allow_nil? false
        public? true
      end

      run fn input, _context ->
        SessionMessagesLoader.for_session(input.arguments.session_id)
      end
    end

    action :event_snapshot_for_session, :map do
      argument :session_id, :string do
        allow_nil? false
        public? true
      end

      run fn input, _context ->
        AgentSessionRead.snapshot_for_session(input.arguments.session_id)
      end
    end
  end
end

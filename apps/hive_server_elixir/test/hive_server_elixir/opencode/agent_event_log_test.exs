defmodule HiveServerElixir.Opencode.AgentEventLogTest do
  use HiveServerElixir.DataCase, async: false

  alias HiveServerElixir.Opencode.AgentEventLog

  describe "append/1" do
    test "persists an event envelope" do
      attrs = event_attrs(seq: 1, session_id: "session-a")

      assert {:ok, entry} = AgentEventLog.append(attrs)
      assert entry.workspace_id == attrs.workspace_id
      assert entry.cell_id == attrs.cell_id
      assert entry.session_id == attrs.session_id
      assert entry.seq == attrs.seq
      assert entry.event_type == attrs.event_type
      assert entry.payload == attrs.payload
    end

    test "enforces unique sequence per session" do
      attrs = event_attrs(seq: 7, session_id: "session-b")

      assert {:ok, _entry} = AgentEventLog.append(attrs)
      assert {:error, _error} = AgentEventLog.append(attrs)

      assert [%{seq: 7}] = AgentEventLog.list_session_timeline("session-b")
    end
  end

  describe "list_session_timeline/1" do
    test "returns events ordered by sequence" do
      assert {:ok, _entry} = AgentEventLog.append(event_attrs(seq: 2, session_id: "session-c"))
      assert {:ok, _entry} = AgentEventLog.append(event_attrs(seq: 1, session_id: "session-c"))
      assert {:ok, _entry} = AgentEventLog.append(event_attrs(seq: 3, session_id: "session-d"))

      assert [first, second] = AgentEventLog.list_session_timeline("session-c")
      assert first.seq == 1
      assert second.seq == 2
    end
  end

  describe "append_global_event/2" do
    test "derives session id from payload and auto-increments sequence" do
      global_event = %{
        "directory" => "/tmp/project",
        "payload" => %{"type" => "session.idle", "properties" => %{"sessionID" => "session-e"}}
      }

      context = %{workspace_id: "workspace-1", cell_id: "cell-1"}

      assert {:ok, first} = AgentEventLog.append_global_event(global_event, context)
      assert {:ok, second} = AgentEventLog.append_global_event(global_event, context)

      assert first.session_id == "session-e"
      assert first.seq == 1
      assert second.session_id == "session-e"
      assert second.seq == 2
    end

    test "uses global fallback session when event has no session id" do
      global_event = %{
        "directory" => "/tmp/project",
        "payload" => %{"type" => "server.connected"}
      }

      context = %{workspace_id: "workspace-1", cell_id: "cell-1"}

      assert {:ok, entry} = AgentEventLog.append_global_event(global_event, context)

      assert entry.session_id == "global"
      assert entry.seq == 1
      assert entry.event_type == "server.connected"
    end

    test "allocates unique ordered sequences under concurrent writes" do
      global_event = %{
        "payload" => %{"type" => "session.idle", "properties" => %{"sessionID" => "session-f"}}
      }

      context = %{workspace_id: "workspace-1", cell_id: "cell-1"}

      seqs =
        1..10
        |> Task.async_stream(
          fn _ ->
            {:ok, entry} = AgentEventLog.append_global_event(global_event, context)
            entry.seq
          end,
          ordered: false,
          timeout: :infinity
        )
        |> Enum.map(fn {:ok, seq} -> seq end)
        |> Enum.sort()

      assert seqs == Enum.to_list(1..10)
    end
  end

  defp event_attrs(overrides) do
    %{
      workspace_id: "workspace-1",
      cell_id: "cell-1",
      session_id: "session-default",
      seq: 0,
      event_type: "session.idle",
      payload: %{"payload" => %{"type" => "session.idle"}}
    }
    |> Map.merge(Map.new(overrides))
  end
end

defmodule HiveServerElixir.Opencode.EventIngestTest do
  use HiveServerElixir.DataCase, async: false

  alias HiveServerElixir.Opencode.AgentEventLog
  alias HiveServerElixir.Opencode.EventIngest
  alias HiveServerElixir.Opencode.TestOperations

  test "ingest_next pulls and persists events with stable per-session ordering" do
    context = %{workspace_id: "workspace-1", cell_id: "cell-1"}

    first_event =
      global_event_payload(type: "session.idle", session_id: "session-z", detail: %{"step" => 1})

    second_event =
      global_event_payload(
        type: "session.status",
        session_id: "session-z",
        detail: %{"step" => 2}
      )

    assert {:ok, ^first_event} =
             EventIngest.ingest_next(
               context,
               operations_module: TestOperations,
               global_event: fn _opts -> {:ok, first_event} end
             )

    assert {:ok, ^second_event} =
             EventIngest.ingest_next(
               context,
               operations_module: TestOperations,
               global_event: fn _opts -> {:ok, second_event} end
             )

    assert [first, second] = AgentEventLog.list_session_timeline("session-z")
    assert first.seq == 1
    assert second.seq == 2
    assert first.event_type == "session.idle"
    assert second.event_type == "session.status"
  end

  defp global_event_payload(attrs) do
    attrs = Map.new(attrs)
    type = Map.fetch!(attrs, :type)
    session_id = Map.fetch!(attrs, :session_id)

    %{
      "directory" => "/tmp/project",
      "payload" => %{
        "type" => type,
        "properties" =>
          %{"sessionID" => session_id}
          |> Map.merge(Map.get(attrs, :detail, %{}))
      }
    }
  end
end

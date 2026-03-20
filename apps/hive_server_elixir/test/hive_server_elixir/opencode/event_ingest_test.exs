defmodule HiveServerElixir.Opencode.EventIngestTest do
  use HiveServerElixir.DataCase, async: false

  alias HiveServerElixir.Opencode.AgentEventLog
  alias HiveServerElixir.Opencode.EventIngest

  test "ingest_stream_item persists events with stable per-session ordering" do
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
             EventIngest.ingest_stream_item(first_event, context)

    assert {:ok, ^second_event} =
             EventIngest.ingest_stream_item(second_event, context)

    assert [first, second] = AgentEventLog.list_session_timeline("session-z")
    assert first.seq == 1
    assert second.seq == 2
    assert first.event_type == "session.idle"
    assert second.event_type == "session.status"
  end

  test "ingest_stream_item normalizes persistence errors after normalization" do
    context = %{workspace_id: "workspace-1", cell_id: "cell-1"}
    payload = global_event_payload(type: "session.idle", session_id: "session-error")

    assert {:error, error} =
             EventIngest.ingest_stream_item(payload, context,
               persist_global_event: fn _event, _persist_context -> {:error, :db_unavailable} end
             )

    assert error.type == :persistence_error
    assert error.status == nil
    assert error.details == :db_unavailable
  end

  test "ingest_stream_item wraps raw payload maps into the expected event envelope" do
    context = %{workspace_id: "workspace-1", cell_id: "cell-1"}
    raw_payload = %{"type" => "session.idle", "properties" => %{"sessionID" => "session-raw"}}

    assert {:ok, normalized_event} = EventIngest.ingest_stream_item(raw_payload, context)
    assert normalized_event == %{"payload" => raw_payload}

    assert [%{event_type: "session.idle", seq: 1}] =
             AgentEventLog.list_session_timeline("session-raw")
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

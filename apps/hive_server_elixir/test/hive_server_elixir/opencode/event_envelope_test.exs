defmodule HiveServerElixir.Opencode.EventEnvelopeTest do
  use ExUnit.Case, async: true

  alias HiveServerElixir.Opencode.AgentEvent
  alias HiveServerElixir.Opencode.EventEnvelope

  test "parses persisted agent event envelopes" do
    event = %AgentEvent{
      session_id: "session-1",
      event_type: "session.status",
      payload: %{
        "payload" => %{
          "type" => "session.idle",
          "properties" => %{
            "agent" => "build",
            "model" => %{"providerId" => "opencode", "modelId" => "big-pickle"}
          }
        }
      }
    }

    assert EventEnvelope.type(event) == "session.idle"
    assert EventEnvelope.mode(event) == "build"
    assert EventEnvelope.provider_id(event) == "opencode"
    assert EventEnvelope.model_id(event) == "big-pickle"
    assert EventEnvelope.session_id(event) == "session-1"
  end

  test "parses raw global events with alternate key casing" do
    event = %{
      payload: %{
        properties: %{
          sessionID: "session-2",
          currentMode: "plan",
          providerID: "openai",
          modelID: "gpt-5"
        }
      }
    }

    assert EventEnvelope.session_id(event) == "session-2"
    assert EventEnvelope.mode(event) == "plan"
    assert EventEnvelope.provider_id(event) == "openai"
    assert EventEnvelope.model_id(event) == "gpt-5"
  end

  test "gets atom-backed values and falls back to event_type" do
    event = %AgentEvent{event_type: "session.updated", payload: %{payload: %{properties: %{}}}}

    assert EventEnvelope.get(%{currentMode: "build"}, "currentMode") == "build"
    assert EventEnvelope.type(event) == "session.updated"
  end
end

defmodule HiveServerElixir.Cells.ResourceSnapshotPayload do
  @moduledoc false

  alias HiveServerElixir.Cells.Activity
  alias HiveServerElixir.Cells.AgentSession
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.CellStatus
  alias HiveServerElixir.Cells.Provisioning
  alias HiveServerElixir.Cells.ResourceSummary
  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.Timing

  @spec build(Cell.t(), map()) :: map()
  def build(%Cell{} = cell, opts \\ %{}) do
    summary =
      ResourceSummary.build(cell, %{
        include_history: truthy?(Map.get(opts, :include_history), false),
        include_averages: truthy?(Map.get(opts, :include_averages), false),
        include_rollups: truthy?(Map.get(opts, :include_rollups), false),
        history_limit: resource_limit(Map.get(opts, :history_limit), 180),
        rollup_limit: resource_limit(Map.get(opts, :rollup_limit), 96)
      })

    resources = resource_snapshot(cell.id)

    Map.merge(summary, %{
      resources: resources,
      failures: failure_states(cell, resources)
    })
  end

  defp resource_snapshot(cell_id) do
    provisioning = Provisioning.fetch_for_cell(cell_id)
    agent_session = AgentSession.fetch_for_cell(cell_id)
    latest_activity = Activity.latest_for_cell(cell_id)
    latest_timing = Timing.latest_for_cell(cell_id)

    %{
      provisioning: Provisioning.snapshot_payload(provisioning),
      services: Service.snapshot_payloads_for_cell(cell_id),
      agentSession: AgentSession.snapshot_payload(agent_session),
      latestActivity: Activity.snapshot_payload(latest_activity),
      latestTiming: Timing.snapshot_payload(latest_timing)
    }
  end

  defp failure_states(cell, resources) do
    []
    |> maybe_add_failure(CellStatus.error?(cell) and is_nil(resources.provisioning), %{
      code: "provisioning_missing",
      resource: "provisioning",
      message: "Cell is in error status without provisioning state"
    })
    |> maybe_add_failure(
      (CellStatus.ready?(cell) or CellStatus.error?(cell)) and is_nil(resources.agentSession),
      %{
        code: "agent_session_missing",
        resource: "agent_session",
        message: "Cell lifecycle is missing an agent session"
      }
    )
    |> maybe_add_service_failures(resources.services)
    |> maybe_add_failure(is_binary(agent_session_error(resources.agentSession)), %{
      code: "agent_session_error",
      resource: "agent_session",
      message: agent_session_error(resources.agentSession)
    })
  end

  defp maybe_add_service_failures(failures, services) do
    Enum.reduce(services, failures, fn service, acc ->
      should_add = service.status == "error" or is_binary(service.lastKnownError)

      maybe_add_failure(acc, should_add, %{
        code: "service_error",
        resource: "service",
        serviceId: service.id,
        message: service.lastKnownError || "Service is in error status",
        serviceName: service.name
      })
    end)
  end

  defp maybe_add_failure(failures, true, failure), do: [failure | failures]
  defp maybe_add_failure(failures, false, _failure), do: failures

  defp truthy?(value, _default) when is_boolean(value), do: value
  defp truthy?("true", _default), do: true
  defp truthy?("1", _default), do: true
  defp truthy?("false", _default), do: false
  defp truthy?("0", _default), do: false
  defp truthy?(_value, default), do: default

  defp resource_limit(value, _default) when is_integer(value), do: clamp(value, 1, 10_000)

  defp resource_limit(value, default) when is_binary(value) do
    case Integer.parse(value) do
      {parsed, ""} -> clamp(parsed, 1, 10_000)
      _result -> default
    end
  end

  defp resource_limit(_value, default), do: default

  defp clamp(value, min, _max) when value < min, do: min
  defp clamp(value, _min, max) when value > max, do: max
  defp clamp(value, _min, _max), do: value

  defp agent_session_error(%{lastError: last_error}) when is_binary(last_error), do: last_error
  defp agent_session_error(_session), do: nil
end

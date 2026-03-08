defmodule HiveServerElixir.Cells.ResourceSnapshotPayload do
  @moduledoc false

  import Ash.Expr
  require Ash.Query

  alias HiveServerElixir.Cells
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
    provisioning = find_one_by_cell(Provisioning, cell_id)
    services = list_by_cell(Service, cell_id)
    agent_session = find_one_by_cell(AgentSession, cell_id)
    latest_activity = find_latest_by_cell(Activity, cell_id)
    latest_timing = find_latest_by_cell(Timing, cell_id)

    %{
      provisioning: serialize_provisioning(provisioning),
      services: Enum.map(services, &serialize_service/1),
      agentSession: serialize_agent_session(agent_session),
      latestActivity: serialize_activity(latest_activity),
      latestTiming: serialize_timing(latest_timing)
    }
  end

  defp find_one_by_cell(resource, cell_id) do
    resource
    |> Ash.Query.filter(expr(cell_id == ^cell_id))
    |> Ash.read_one(domain: Cells)
    |> case do
      {:ok, value} -> value
      {:error, _reason} -> nil
    end
  end

  defp find_latest_by_cell(resource, cell_id) do
    resource
    |> Ash.Query.filter(expr(cell_id == ^cell_id))
    |> Ash.Query.sort(inserted_at: :desc)
    |> Ash.Query.limit(1)
    |> Ash.read(domain: Cells)
    |> case do
      {:ok, [value | _]} -> value
      {:ok, []} -> nil
      {:error, _reason} -> nil
    end
  end

  defp list_by_cell(resource, cell_id) do
    resource
    |> Ash.Query.filter(expr(cell_id == ^cell_id))
    |> Ash.Query.sort(inserted_at: :asc)
    |> Ash.read(domain: Cells)
    |> case do
      {:ok, values} -> values
      {:error, _reason} -> []
    end
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

  defp serialize_service(%Service{} = service) do
    %{
      id: service.id,
      cellId: service.cell_id,
      name: service.name,
      type: service.type,
      status: service.status,
      pid: service.pid,
      port: service.port,
      command: service.command,
      cwd: service.cwd,
      env: service.env,
      lastKnownError: service.last_known_error,
      insertedAt: maybe_to_iso8601(service.inserted_at),
      updatedAt: maybe_to_iso8601(service.updated_at)
    }
  end

  defp serialize_provisioning(nil), do: nil

  defp serialize_provisioning(%Provisioning{} = provisioning) do
    %{
      id: provisioning.id,
      cellId: provisioning.cell_id,
      attemptCount: provisioning.attempt_count,
      startMode: provisioning.start_mode,
      startedAt: maybe_to_iso8601(provisioning.started_at),
      finishedAt: maybe_to_iso8601(provisioning.finished_at),
      insertedAt: maybe_to_iso8601(provisioning.inserted_at),
      updatedAt: maybe_to_iso8601(provisioning.updated_at)
    }
  end

  defp serialize_agent_session(nil), do: nil

  defp serialize_agent_session(%AgentSession{} = session) do
    %{
      id: session.id,
      cellId: session.cell_id,
      sessionId: session.session_id,
      currentMode: session.current_mode,
      modelId: session.model_id,
      modelProviderId: session.model_provider_id,
      lastError: session.last_error,
      insertedAt: maybe_to_iso8601(session.inserted_at),
      updatedAt: maybe_to_iso8601(session.updated_at)
    }
  end

  defp serialize_activity(nil), do: nil

  defp serialize_activity(%Activity{} = activity) do
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

  defp serialize_timing(nil), do: nil

  defp serialize_timing(%Timing{} = timing) do
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

  defp maybe_to_iso8601(nil), do: nil
  defp maybe_to_iso8601(datetime), do: DateTime.to_iso8601(datetime)
end

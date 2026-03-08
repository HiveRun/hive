defmodule HiveServerElixir.Cells.ServiceSnapshot do
  @moduledoc false

  import Ash.Expr
  require Ash.Query

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.ServicePayload
  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.ServiceRuntime
  alias HiveServerElixir.Cells.TerminalRuntime

  @default_log_lines 200
  @default_log_offset 0
  @preserve_nil_service_keys MapSet.new([:cpu_percent, :rss_bytes])

  def payload_fields, do: ServicePayload.fields()

  def list_rpc_payloads(cell_id, opts \\ %{}) when is_binary(cell_id) do
    cell_id
    |> list_services()
    |> Enum.map(&rpc_payload(&1, opts))
  end

  def list_transport_payloads(cell_id, opts \\ %{}) when is_binary(cell_id) do
    cell_id
    |> list_rpc_payloads(opts)
    |> Enum.map(&camelize_top_level_keys/1)
  end

  def rpc_payload(%Service{} = service, opts \\ %{}) do
    normalized_opts = normalize_opts(opts)
    include_resources = Map.get(normalized_opts, :include_resources, false)
    {recent_logs, total_log_lines, has_more_logs} = service_log_tail(service, normalized_opts)

    runtime_status = ServiceRuntime.runtime_status(service.id)

    process_alive =
      case runtime_status do
        %{status: "running"} -> true
        _other -> os_pid_alive?(service.pid)
      end

    {derived_status, derived_last_known_error} =
      derive_service_state(service.status, service.last_known_error, process_alive)

    derived_pid =
      case runtime_status do
        %{status: "running", pid: pid} when is_integer(pid) -> pid
        _other when process_alive -> service.pid
        _other -> nil
      end

    service =
      maybe_persist_derived_service(
        service,
        derived_status,
        derived_last_known_error,
        derived_pid
      )

    resource_payload =
      if include_resources do
        build_service_resource_payload(derived_pid, process_alive)
      else
        %{}
      end

    url = build_service_url(service.port)
    port_reachable = if is_integer(service.port), do: port_reachable?(service.port), else: nil

    %{
      id: service.id,
      name: service.name,
      type: service.type,
      status: derived_status,
      command: service.command,
      cwd: service.cwd,
      log_path: nil,
      last_known_error: derived_last_known_error,
      env: service.env,
      updated_at: maybe_to_iso8601(service.updated_at),
      recent_logs: recent_logs,
      total_log_lines: total_log_lines,
      has_more_logs: has_more_logs,
      process_alive: process_alive,
      port_reachable: port_reachable,
      url: url,
      pid: derived_pid,
      port: service.port
    }
    |> Map.merge(resource_payload)
    |> drop_nil_values()
  end

  def transport_payload(%Service{} = service, opts \\ %{}) do
    service
    |> rpc_payload(opts)
    |> camelize_top_level_keys()
  end

  defp list_services(cell_id) do
    Service
    |> Ash.Query.filter(expr(cell_id == ^cell_id))
    |> Ash.Query.sort(inserted_at: :asc)
    |> Ash.read!(domain: Cells)
  end

  defp normalize_opts(opts) when is_map(opts) do
    %{
      lines: Map.get(opts, :lines, @default_log_lines),
      offset: Map.get(opts, :offset, @default_log_offset),
      include_resources: Map.get(opts, :include_resources, false)
    }
  end

  defp service_log_tail(%Service{} = service, %{lines: lines, offset: offset}) do
    chunks = TerminalRuntime.read_service_output(service.cell_id, service.id)

    if chunks == [] do
      {nil, nil, false}
    else
      output = Enum.join(chunks, "")
      normalized = String.replace(output, "\r\n", "\n") |> String.replace("\r", "\n")
      all_lines = String.split(normalized, "\n")
      total_lines = length(all_lines)

      end_index = max(total_lines - offset, 0)
      start_index = max(end_index - lines, 0)
      selected = Enum.slice(all_lines, start_index, end_index - start_index)
      content = selected |> Enum.join("\n") |> String.trim_trailing()

      {if(content == "", do: nil, else: content), total_lines, start_index > 0}
    end
  end

  defp build_service_resource_payload(pid, process_alive) do
    sampled_at = DateTime.utc_now() |> DateTime.truncate(:second) |> DateTime.to_iso8601()

    sampled_metrics =
      if is_integer(pid) and process_alive do
        sample_process_resources(pid)
      else
        nil
      end

    case sampled_metrics do
      %{cpu_percent: cpu_percent, rss_bytes: rss_bytes} ->
        %{
          cpu_percent: cpu_percent,
          rss_bytes: rss_bytes,
          resource_sampled_at: sampled_at
        }

      _other ->
        %{
          cpu_percent: nil,
          rss_bytes: nil,
          resource_sampled_at: sampled_at,
          resource_unavailable_reason: service_resource_unavailable_reason(pid, process_alive)
        }
    end
  end

  defp sample_process_resources(pid) when is_integer(pid) and pid > 0 do
    case System.cmd("ps", ["-p", Integer.to_string(pid), "-o", "%cpu=,rss="],
           stderr_to_stdout: true
         ) do
      {output, 0} -> parse_process_sample(output)
      _other -> nil
    end
  end

  defp sample_process_resources(_pid), do: nil

  defp parse_process_sample(output) when is_binary(output) do
    case output |> String.trim() |> String.split(~r/\s+/, trim: true) do
      [cpu_raw, rss_raw | _rest] ->
        with {cpu_percent, ""} <- Float.parse(cpu_raw),
             {rss_kb, ""} <- Integer.parse(rss_raw) do
          %{
            cpu_percent: Float.round(cpu_percent, 3),
            rss_bytes: max(rss_kb, 0) * 1024
          }
        else
          _other -> nil
        end

      _other ->
        nil
    end
  end

  defp parse_process_sample(_output), do: nil

  defp service_resource_unavailable_reason(pid, _process_alive) when not is_integer(pid),
    do: "pid_missing"

  defp service_resource_unavailable_reason(_pid, false), do: "process_not_alive"
  defp service_resource_unavailable_reason(_pid, true), do: "sample_failed"

  defp derive_service_state("running", last_known_error, false) do
    {"error", last_known_error || "Process exited unexpectedly"}
  end

  defp derive_service_state("error", _last_known_error, true) do
    {"running", nil}
  end

  defp derive_service_state(status, last_known_error, _alive) do
    {status, last_known_error}
  end

  defp maybe_persist_derived_service(%Service{} = service, status, last_known_error, pid) do
    should_persist =
      status != service.status ||
        last_known_error != service.last_known_error ||
        pid != service.pid

    if should_persist do
      case Ash.update(service, %{status: status, last_known_error: last_known_error, pid: pid},
             domain: Cells
           ) do
        {:ok, updated} ->
          updated

        {:error, _error} ->
          %{service | status: status, last_known_error: last_known_error, pid: pid}
      end
    else
      service
    end
  end

  defp os_pid_alive?(pid) when is_integer(pid) and pid > 0 do
    case System.cmd("kill", ["-0", Integer.to_string(pid)], stderr_to_stdout: true) do
      {_output, 0} -> true
      {_output, _status} -> false
    end
  rescue
    _error ->
      false
  end

  defp os_pid_alive?(_pid), do: false

  defp port_reachable?(port) when is_integer(port) and port > 0 do
    case :gen_tcp.connect(~c"127.0.0.1", port, [:binary, active: false], 150) do
      {:ok, socket} ->
        :gen_tcp.close(socket)
        true

      {:error, _reason} ->
        false
    end
  end

  defp port_reachable?(_port), do: false

  defp build_service_url(port) when is_integer(port) and port > 0,
    do: "http://localhost:" <> Integer.to_string(port)

  defp build_service_url(_port), do: nil

  defp drop_nil_values(map) when is_map(map) do
    map
    |> Enum.reject(fn {key, value} ->
      is_nil(value) and not MapSet.member?(@preserve_nil_service_keys, key)
    end)
    |> Map.new()
  end

  defp camelize_top_level_keys(map) when is_map(map) do
    Map.new(map, fn {key, value} -> {camelize_key(key), value} end)
  end

  defp camelize_key(key) when is_atom(key) do
    key
    |> Atom.to_string()
    |> camelize_key()
  end

  defp camelize_key(key) when is_binary(key) do
    key
    |> Macro.camelize()
    |> then(fn
      <<first::utf8, rest::binary>> -> String.downcase(<<first::utf8>>) <> rest
      "" -> ""
    end)
  end

  defp maybe_to_iso8601(%DateTime{} = value), do: DateTime.to_iso8601(value)
  defp maybe_to_iso8601(%NaiveDateTime{} = value), do: NaiveDateTime.to_iso8601(value)
  defp maybe_to_iso8601(value) when is_binary(value), do: value
  defp maybe_to_iso8601(_value), do: nil
end

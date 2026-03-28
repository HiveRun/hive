defmodule HiveServerElixir.Cells.ServiceSnapshot do
  @moduledoc false

  alias HiveServerElixir.Cells.Service
  alias HiveServerElixir.Cells.ServicePayload
  alias HiveServerElixir.Cells.ServiceReconciliation
  alias HiveServerElixir.Cells.ServiceStatus
  alias HiveServerElixir.Cells.TerminalRuntime

  @default_log_lines 200
  @default_log_offset 0
  @preserve_nil_service_keys MapSet.new([:cpu_percent, :rss_bytes])

  def payload_fields, do: ServicePayload.fields()

  def list_rpc_payloads(cell_id, opts \\ %{}) when is_binary(cell_id) do
    cell_id
    |> list_services()
    |> ServiceReconciliation.reconcile_all()
    |> Enum.map(&snapshot_payload(&1, opts))
  end

  def list_transport_payloads(cell_id, opts \\ %{}) when is_binary(cell_id) do
    cell_id
    |> list_rpc_payloads(opts)
    |> Enum.map(&camelize_top_level_keys/1)
  end

  def rpc_payload(%Service{} = service, opts \\ %{}) do
    service
    |> ServiceReconciliation.reconcile()
    |> snapshot_payload(opts)
  end

  defp snapshot_payload(%{service: service} = snapshot, opts) do
    normalized_opts = normalize_opts(opts)
    include_resources = Map.get(normalized_opts, :include_resources, false)
    {recent_logs, total_log_lines, has_more_logs} = service_log_tail(service, normalized_opts)

    resource_payload =
      if include_resources do
        build_service_resource_payload(snapshot.pid, snapshot.process_alive)
      else
        %{}
      end

    url = build_service_url(service.port)
    port_reachable = if is_integer(service.port), do: port_reachable?(service.port), else: nil

    %{
      id: service.id,
      name: service.name,
      type: service.type,
      status: ServiceStatus.present(snapshot.status),
      command: service.command,
      cwd: service.cwd,
      log_path: nil,
      last_known_error: snapshot.last_known_error,
      env: service.env,
      updated_at: maybe_to_iso8601(service.updated_at),
      recent_logs: recent_logs,
      total_log_lines: total_log_lines,
      has_more_logs: has_more_logs,
      process_alive: snapshot.process_alive,
      port_reachable: port_reachable,
      url: url,
      pid: snapshot.pid,
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

  def channel_payload(%Service{} = service) do
    %{
      id: service.id,
      name: service.name,
      type: service.type,
      status: ServiceStatus.present(service.status),
      command: service.command,
      cwd: service.cwd,
      log_path: nil,
      last_known_error: service.last_known_error,
      env: service.env,
      updated_at: maybe_to_iso8601(service.updated_at),
      recent_logs: nil,
      total_log_lines: nil,
      has_more_logs: false,
      process_alive: is_integer(service.pid),
      port_reachable: if(is_integer(service.port), do: port_reachable?(service.port), else: nil),
      url: build_service_url(service.port),
      pid: service.pid,
      port: service.port,
      cpu_percent: nil,
      rss_bytes: nil,
      resource_sampled_at: nil,
      resource_unavailable_reason: nil
    }
    |> camelize_top_level_keys()
  end

  defp list_services(cell_id) do
    Service.list_for_cell(cell_id)
  end

  defp normalize_opts(opts) when is_map(opts) do
    opts
    |> Service.snapshot_options()
    |> Map.put_new(:lines, @default_log_lines)
    |> Map.put_new(:offset, @default_log_offset)
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

defmodule HiveServerElixir.Cells.ServicePayload do
  @moduledoc false

  @fields [
    id: [type: :uuid, allow_nil?: false],
    name: [type: :string, allow_nil?: false],
    type: [type: :string, allow_nil?: false],
    status: [type: :string, allow_nil?: false],
    command: [type: :string, allow_nil?: false],
    cwd: [type: :string, allow_nil?: false],
    log_path: [type: :string, allow_nil?: true],
    last_known_error: [type: :string, allow_nil?: true],
    env: [type: :map, allow_nil?: false],
    updated_at: [type: :string, allow_nil?: true],
    recent_logs: [type: :string, allow_nil?: true],
    total_log_lines: [type: :integer, allow_nil?: true],
    has_more_logs: [type: :boolean, allow_nil?: false],
    process_alive: [type: :boolean, allow_nil?: false],
    port_reachable: [type: :boolean, allow_nil?: true],
    url: [type: :string, allow_nil?: true],
    pid: [type: :integer, allow_nil?: true],
    port: [type: :integer, allow_nil?: true],
    cpu_percent: [type: :float, allow_nil?: true],
    rss_bytes: [type: :integer, allow_nil?: true],
    resource_sampled_at: [type: :string, allow_nil?: true],
    resource_unavailable_reason: [type: :string, allow_nil?: true]
  ]

  def fields, do: @fields
end

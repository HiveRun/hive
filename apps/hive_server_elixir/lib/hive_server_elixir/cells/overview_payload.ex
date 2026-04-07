defmodule HiveServerElixir.Cells.OverviewPayload do
  @moduledoc false

  alias HiveServerElixir.Cells.ServiceSnapshot
  alias HiveServerElixir.Cells.TemplateConfig

  @service_fields [
    id: [type: :uuid, allow_nil?: false],
    name: [type: :string, allow_nil?: false],
    status: [type: :string, allow_nil?: false],
    port: [type: :integer, allow_nil?: true],
    cpu_percent: [type: :float, allow_nil?: true],
    rss_bytes: [type: :integer, allow_nil?: true]
  ]

  @cell_fields [
    id: [type: :uuid, allow_nil?: false],
    name: [type: :string, allow_nil?: false],
    description: [type: :string, allow_nil?: true],
    status: [type: :string, allow_nil?: false],
    workspace_id: [type: :uuid, allow_nil?: false],
    template_id: [type: :string, allow_nil?: false],
    branch_name: [type: :string, allow_nil?: true],
    base_commit: [type: :string, allow_nil?: true],
    inserted_at: [type: :string, allow_nil?: true],
    updated_at: [type: :string, allow_nil?: true],
    template_label: [type: :string, allow_nil?: true],
    services: [type: {:array, :map}, allow_nil?: false, constraints: [fields: @service_fields]]
  ]

  @workspace_fields [
    id: [type: :uuid, allow_nil?: false],
    label: [type: :string, allow_nil?: false],
    path: [type: :string, allow_nil?: false],
    last_opened_at: [type: :string, allow_nil?: true],
    inserted_at: [type: :string, allow_nil?: true],
    cells: [type: {:array, :map}, allow_nil?: false, constraints: [fields: @cell_fields]]
  ]

  @payload_fields [
    workspaces: [
      type: {:array, :map},
      allow_nil?: false,
      constraints: [fields: @workspace_fields]
    ],
    active_workspace_id: [type: :uuid, allow_nil?: true]
  ]

  def fields, do: @payload_fields

  @spec build() :: {:ok, map()}
  def build do
    workspaces = workspace_resource() |> Ash.Query.for_read(:ui_list, %{}) |> Ash.read!()
    cells = cell_resource() |> Ash.Query.for_read(:ui_list, %{}) |> Ash.read!()
    services_by_cell_id = build_services_by_cell_id(cells)

    payload_workspaces =
      Enum.map(workspaces, fn workspace ->
        templates_by_id = templates_by_id(workspace.path)

        workspace_cells =
          cells
          |> Enum.filter(&(&1.workspace_id == workspace.id))
          |> Enum.map(fn cell ->
            %{
              id: cell.id,
              name: cell.name,
              description: cell.description,
              status: to_string(cell.status),
              workspace_id: cell.workspace_id,
              template_id: cell.template_id,
              branch_name: cell.branch_name,
              base_commit: cell.base_commit,
              inserted_at: to_iso8601(cell.inserted_at),
              updated_at: to_iso8601(cell.updated_at),
              template_label: Map.get(templates_by_id, cell.template_id),
              services: Map.get(services_by_cell_id, cell.id, [])
            }
          end)

        %{
          id: workspace.id,
          label: present_workspace_label(workspace),
          path: workspace.path,
          last_opened_at: to_iso8601(workspace.last_opened_at),
          inserted_at: to_iso8601(workspace.inserted_at),
          cells: workspace_cells
        }
      end)

    {:ok,
     %{
       workspaces: payload_workspaces,
       active_workspace_id: List.first(workspaces) && List.first(workspaces).id
     }}
  end

  defp build_services_by_cell_id(cells) do
    ready_cell_ids =
      cells
      |> Enum.filter(&(&1.status == :ready))
      |> Enum.map(& &1.id)
      |> MapSet.new()

    service_resource()
    |> Ash.read!()
    |> Enum.filter(&MapSet.member?(ready_cell_ids, &1.cell_id))
    |> Enum.group_by(& &1.cell_id, &service_payload/1)
  end

  defp service_payload(service) do
    snapshot =
      ServiceSnapshot.rpc_payload(service, %{
        include_resources: true,
        lines: 0,
        offset: 0
      })

    %{
      id: service.id,
      name: service.name,
      status: snapshot.status,
      port: snapshot.port,
      cpu_percent: snapshot.cpu_percent,
      rss_bytes: snapshot.rss_bytes
    }
  end

  defp templates_by_id(workspace_path) do
    with {:ok, config} <- TemplateConfig.load_workspace_config(workspace_path),
         templates when is_map(templates) <- Map.get(config, "templates", %{}) do
      Map.new(templates, fn {id, template} ->
        label =
          case template do
            %{"label" => value} when is_binary(value) and value != "" -> value
            _other -> id
          end

        {id, label}
      end)
    else
      _other -> %{}
    end
  end

  defp to_iso8601(nil), do: nil
  defp to_iso8601(%DateTime{} = value), do: DateTime.to_iso8601(value)
  defp to_iso8601(value), do: value

  defp workspace_resource, do: HiveServerElixir.Cells.Workspace
  defp cell_resource, do: HiveServerElixir.Cells.Cell
  defp service_resource, do: HiveServerElixir.Cells.Service

  defp present_workspace_label(%{label: label, path: _path})
       when is_binary(label) and label != "",
       do: label

  defp present_workspace_label(%{path: path}) do
    path |> String.split("/", trim: true) |> List.last() |> Kernel.||(path)
  end
end

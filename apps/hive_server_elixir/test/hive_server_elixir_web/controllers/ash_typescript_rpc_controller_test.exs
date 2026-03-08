defmodule HiveServerElixirWeb.AshTypescriptRpcControllerTest do
  use HiveServerElixirWeb.ConnCase

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Activity
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Timing
  alias HiveServerElixir.Cells.Workspace
  alias HiveServerElixir.Workspaces

  test "list_workspaces returns Ash-backed workspace records", %{conn: conn} do
    older = workspace!("rpc-older")
    newer = workspace!("rpc-newer")
    :ok = Workspaces.set_active_workspace_id(newer.id)

    payload =
      rpc_run(conn, "list_workspaces", %{
        "fields" => ["id", "path", "label", "lastOpenedAt", "insertedAt"]
      })

    assert payload["success"] == true
    assert [first | _rest] = payload["data"]
    assert first["id"] == newer.id
    assert first["path"] == newer.path
    assert is_binary(first["insertedAt"])
    assert is_binary(first["lastOpenedAt"])

    assert Enum.any?(payload["data"], fn workspace -> workspace["id"] == older.id end)
  end

  test "list_cells and get_cell return Ash-backed cell records", %{conn: conn} do
    workspace = workspace!("rpc-cells")
    cell = cell!(workspace, "ready")
    _deleting_cell = cell!(workspace, "deleting")

    list_payload =
      rpc_run(conn, "list_cells", %{
        "input" => %{"workspaceId" => workspace.id},
        "fields" => ["id", "workspaceId", "name", "status", "workspacePath", "insertedAt"]
      })

    assert list_payload["success"] == true
    assert [%{"id" => returned_id, "status" => "ready"}] = list_payload["data"]
    assert returned_id == cell.id

    get_payload =
      rpc_run(conn, "get_cell", %{
        "input" => %{"id" => cell.id},
        "fields" => [
          "id",
          "workspaceId",
          "templateId",
          "workspacePath",
          "workspaceRootPath",
          "status"
        ]
      })

    assert get_payload["success"] == true
    assert get_payload["data"]["id"] == cell.id
    assert get_payload["data"]["workspaceId"] == workspace.id
    assert get_payload["data"]["workspacePath"] == workspace.path
    assert get_payload["data"]["workspaceRootPath"] == workspace.path
    assert get_payload["data"]["templateId"] == "default-template"
  end

  test "list_cell_activity returns raw activity records", %{conn: conn} do
    workspace = workspace!("rpc-activity")
    cell = cell!(workspace, "ready")

    assert {:ok, _activity} =
             Ash.create(Activity, %{cell_id: cell.id, type: "service.start", metadata: %{}},
               domain: Cells
             )

    payload =
      rpc_run(conn, "list_cell_activity", %{
        "input" => %{"cellId" => cell.id, "limit" => 5},
        "fields" => ["id", "cellId", "type", "insertedAt"]
      })

    assert payload["success"] == true

    assert [
             %{
               "cellId" => returned_cell_id,
               "type" => "service.start",
               "insertedAt" => inserted_at
             }
           ] =
             payload["data"]

    assert returned_cell_id == cell.id
    assert is_binary(inserted_at)
  end

  test "list timing actions return raw timing records", %{conn: conn} do
    workspace = workspace!("rpc-timings")
    cell = cell!(workspace, "ready")

    assert {:ok, _timing} =
             Ash.create(
               Timing,
               %{
                 cell_id: cell.id,
                 cell_name: "Cell",
                 workspace_id: workspace.id,
                 template_id: "default-template",
                 workflow: "create",
                 run_id: "run-rpc",
                 step: "ensure_services",
                 status: "ok",
                 duration_ms: 10,
                 metadata: %{}
               },
               domain: Cells
             )

    fields = [
      "id",
      "cellId",
      "workspaceId",
      "workflow",
      "runId",
      "step",
      "status",
      "durationMs",
      "insertedAt"
    ]

    cell_payload =
      rpc_run(conn, "list_cell_timings", %{
        "input" => %{"cellId" => cell.id, "limit" => 10},
        "fields" => fields
      })

    assert cell_payload["success"] == true
    assert [%{"cellId" => returned_cell_id, "runId" => "run-rpc"}] = cell_payload["data"]
    assert returned_cell_id == cell.id

    global_payload =
      rpc_run(conn, "list_global_cell_timings", %{
        "input" => %{"cellId" => cell.id, "limit" => 10},
        "fields" => fields
      })

    assert global_payload["success"] == true

    assert [%{"workspaceId" => returned_workspace_id, "runId" => "run-rpc"}] =
             global_payload["data"]

    assert returned_workspace_id == workspace.id
  end

  defp rpc_run(conn, action, payload) do
    conn = post(conn, ~p"/rpc/run", Map.put(payload, "action", action))
    json_response(conn, 200)
  end

  defp workspace!(suffix) do
    path =
      Path.join(System.tmp_dir!(), "hive-rpc-#{suffix}-#{System.unique_integer([:positive])}")

    assert {:ok, workspace} =
             Ash.create(
               Workspace,
               %{path: path, label: "Workspace #{suffix}"},
               domain: Cells
             )

    workspace
  end

  defp cell!(workspace, status) do
    assert {:ok, cell} =
             Ash.create(
               Cell,
               %{
                 workspace_id: workspace.id,
                 name: "Cell",
                 template_id: "default-template",
                 workspace_root_path: workspace.path,
                 workspace_path: workspace.path,
                 status: status
               },
               domain: Cells
             )

    cell
  end
end

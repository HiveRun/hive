defmodule HiveServerElixirWeb.CellsControllerTest do
  use HiveServerElixirWeb.ConnCase

  import Ash.Expr
  require Ash.Query

  alias Ecto.UUID
  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Cell
  alias HiveServerElixir.Cells.Lifecycle
  alias HiveServerElixir.Cells.Workspace
  alias HiveServerElixir.Opencode.TestOperations

  @registry HiveServerElixir.Opencode.EventIngestRegistry

  setup do
    previous_opts = Application.get_env(:hive_server_elixir, :cell_reactor_runtime_opts)
    Application.put_env(:hive_server_elixir, :cell_reactor_runtime_opts, runtime_opts())

    on_exit(fn ->
      if is_nil(previous_opts) do
        Application.delete_env(:hive_server_elixir, :cell_reactor_runtime_opts)
      else
        Application.put_env(:hive_server_elixir, :cell_reactor_runtime_opts, previous_opts)
      end
    end)

    :ok
  end

  test "POST /api/cells creates a ready cell", %{conn: conn} do
    workspace = workspace!("create")

    conn =
      post(conn, ~p"/api/cells", %{
        "workspaceId" => workspace.id,
        "description" => "API create"
      })

    assert %{"cell" => cell_payload} = json_response(conn, 201)
    assert cell_payload["workspaceId"] == workspace.id
    assert cell_payload["status"] == "ready"
    assert is_binary(cell_payload["id"])

    on_exit(fn ->
      _ =
        Lifecycle.on_cell_delete(%{
          workspace_id: workspace.id,
          cell_id: cell_payload["id"]
        })
    end)
  end

  test "POST /api/cells returns 422 for unknown workspace", %{conn: conn} do
    conn =
      post(conn, ~p"/api/cells", %{
        "workspaceId" => UUID.generate(),
        "description" => "missing workspace"
      })

    assert %{"error" => %{"code" => "lifecycle_failed", "message" => message}} =
             json_response(conn, 422)

    assert is_binary(message)
  end

  test "POST /api/cells/:id/setup/retry returns 400 for invalid ids", %{conn: conn} do
    conn = post(conn, ~p"/api/cells/not-a-uuid/setup/retry", %{})

    assert %{"error" => %{"code" => "invalid_cell_id"}} = json_response(conn, 400)
  end

  test "POST /api/cells/:id/setup/resume returns 404 for missing cells", %{conn: conn} do
    conn = post(conn, ~p"/api/cells/#{UUID.generate()}/setup/resume", %{})

    assert %{"error" => %{"code" => "not_found", "message" => message}} =
             json_response(conn, 404)

    assert is_binary(message)
  end

  test "DELETE /api/cells/:id removes the cell and stops ingest", %{conn: conn} do
    workspace = workspace!("delete")
    cell = cell!(workspace.id, "delete me", "ready")
    context = %{workspace_id: workspace.id, cell_id: cell.id}

    assert {:ok, _pid} = Lifecycle.on_cell_create(context, runtime_opts())
    assert [{_pid, _value}] = Registry.lookup(@registry, {workspace.id, cell.id})

    conn = delete(conn, ~p"/api/cells/#{cell.id}")

    assert %{"cell" => %{"id" => deleted_id}} = json_response(conn, 200)
    assert deleted_id == cell.id
    assert [] = Registry.lookup(@registry, {workspace.id, cell.id})
    assert [] = list_cells_by_id(cell.id)
  end

  defp workspace!(suffix) do
    assert {:ok, workspace} =
             Ash.create(
               Workspace,
               %{path: "/tmp/controller-workspace-#{suffix}", label: "Workspace #{suffix}"},
               domain: Cells
             )

    workspace
  end

  defp cell!(workspace_id, description, status) do
    assert {:ok, cell} =
             Ash.create(
               Cell,
               %{workspace_id: workspace_id, description: description, status: status},
               domain: Cells
             )

    cell
  end

  defp list_cells_by_id(cell_id) do
    Cell
    |> Ash.Query.filter(expr(id == ^cell_id))
    |> Ash.read!(domain: Cells)
  end

  defp runtime_opts do
    [
      adapter_opts: [
        operations_module: TestOperations,
        global_event: fn _opts -> {:error, %{type: :transport, reason: :unreachable}} end
      ],
      success_delay_ms: 30_000,
      error_delay_ms: 30_000
    ]
  end
end

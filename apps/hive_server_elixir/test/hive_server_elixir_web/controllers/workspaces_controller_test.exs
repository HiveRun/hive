defmodule HiveServerElixirWeb.WorkspacesControllerTest do
  use HiveServerElixirWeb.ConnCase

  import Ash.Expr
  require Ash.Query

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Workspace
  alias HiveServerElixir.Workspaces

  setup do
    previous_active_workspace_id = Workspaces.active_workspace_id()

    Workspace
    |> Ash.read!(domain: Cells)
    |> Enum.each(&Ash.destroy!(&1, domain: Cells))

    :ok = Workspaces.set_active_workspace_id(nil)

    on_exit(fn ->
      :ok = Workspaces.set_active_workspace_id(previous_active_workspace_id)
    end)

    :ok
  end

  test "GET /api/workspaces returns list with active workspace", %{conn: conn} do
    workspace = workspace!("list", "/tmp/workspaces-list", "List Workspace")
    :ok = Workspaces.set_active_workspace_id(workspace.id)

    conn = get(conn, ~p"/api/workspaces")

    assert %{"workspaces" => [workspace_payload], "activeWorkspaceId" => active_workspace_id} =
             json_response(conn, 200)

    assert workspace_payload["id"] == workspace.id
    assert workspace_payload["label"] == "List Workspace"
    assert workspace_payload["path"] == "/tmp/workspaces-list"
    assert is_binary(workspace_payload["addedAt"])
    assert workspace_payload["lastOpenedAt"] == nil
    assert active_workspace_id == workspace.id
  end

  test "GET /api/workspaces/browse lists directories and config flag", %{conn: conn} do
    root = tmp_dir!("browse-root")
    with_config = Path.join(root, "with-config")
    without_config = Path.join(root, "without-config")

    File.mkdir_p!(with_config)
    File.mkdir_p!(without_config)
    File.write!(Path.join(with_config, "hive.config.json"), "{}")

    conn = get(conn, ~p"/api/workspaces/browse?path=#{root}")

    assert %{"path" => path, "directories" => directories} = json_response(conn, 200)
    assert path == root

    assert Enum.any?(directories, fn entry ->
             entry["name"] == "with-config" and entry["hasConfig"] == true
           end)

    assert Enum.any?(directories, fn entry ->
             entry["name"] == "without-config" and entry["hasConfig"] == false
           end)
  end

  test "POST /api/workspaces registers workspace and derives label", %{conn: conn} do
    workspace_path = workspace_dir!("register")

    conn = post(conn, ~p"/api/workspaces", %{"path" => workspace_path, "activate" => true})

    assert %{"workspace" => workspace} = json_response(conn, 201)
    assert workspace["path"] == workspace_path
    assert workspace["label"] == Path.basename(workspace_path)
    assert workspace["id"] == Workspaces.active_workspace_id()

    persisted =
      Workspace
      |> Ash.Query.filter(expr(path == ^workspace_path))
      |> Ash.read_one!(domain: Cells)

    assert persisted.id == workspace["id"]
  end

  test "POST /api/workspaces/:id/activate updates active workspace", %{conn: conn} do
    first = workspace!("first", "/tmp/workspaces-first", "First Workspace")
    second = workspace!("second", "/tmp/workspaces-second", "Second Workspace")
    :ok = Workspaces.set_active_workspace_id(first.id)

    conn = post(conn, ~p"/api/workspaces/#{second.id}/activate", %{})
    assert %{"workspace" => workspace} = json_response(conn, 200)
    assert workspace["id"] == second.id
    assert Workspaces.active_workspace_id() == second.id
  end

  test "DELETE /api/workspaces/:id removes workspace and clears active", %{conn: conn} do
    workspace_path = workspace_dir!("delete")

    conn = post(conn, ~p"/api/workspaces", %{"path" => workspace_path, "activate" => true})
    assert %{"workspace" => workspace} = json_response(conn, 201)

    conn = delete(conn, ~p"/api/workspaces/#{workspace["id"]}")
    assert response(conn, 204) == ""

    assert Workspaces.active_workspace_id() == nil

    conn = get(build_conn(), ~p"/api/workspaces")
    assert %{"workspaces" => []} = json_response(conn, 200)
  end

  defp workspace!(_suffix, path, label) do
    assert {:ok, workspace} =
             Ash.create(
               Workspace,
               %{path: path, label: label},
               domain: Cells
             )

    workspace
  end

  defp workspace_dir!(suffix) do
    path = tmp_dir!("workspace-#{suffix}")
    File.write!(Path.join(path, "hive.config.json"), "{}")
    path
  end

  defp tmp_dir!(suffix) do
    path =
      Path.join(
        System.tmp_dir!(),
        "hive-workspaces-#{suffix}-#{System.unique_integer([:positive])}"
      )

    File.mkdir_p!(path)

    on_exit(fn ->
      File.rm_rf!(path)
    end)

    path
  end
end

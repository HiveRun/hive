defmodule HiveServerElixirWeb.WorkspacesControllerTest do
  use HiveServerElixirWeb.ConnCase

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

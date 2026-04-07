defmodule HiveServerElixir.Cells.WorkspaceSnapshotTest do
  use ExUnit.Case, async: false

  alias HiveServerElixir.Cells.WorkspaceSnapshot

  test "ensure_cell_workspace excludes .hive even without explicit ignore patterns" do
    source_root = tmp_dir!("workspace-snapshot-source")
    hive_home = tmp_dir!("workspace-snapshot-hive-home")

    write_file!(Path.join(source_root, "keep.txt"), "keep")
    write_file!(Path.join([source_root, ".hive", "state", "nested.txt"]), "nested")

    previous_hive_home = System.get_env("HIVE_HOME")
    System.put_env("HIVE_HOME", hive_home)

    on_exit(fn ->
      restore_env("HIVE_HOME", previous_hive_home)
      File.rm_rf!(source_root)
      File.rm_rf!(hive_home)
    end)

    assert {:ok, destination} = WorkspaceSnapshot.ensure_cell_workspace("cell-1", source_root)

    assert File.exists?(Path.join(destination, "keep.txt"))
    refute File.exists?(Path.join(destination, ".hive"))
  end

  test "ensure_cell_workspace respects template ignore patterns" do
    source_root = tmp_dir!("workspace-snapshot-template-source")
    hive_home = tmp_dir!("workspace-snapshot-template-hive-home")

    write_file!(Path.join(source_root, "keep.txt"), "keep")
    write_file!(Path.join([source_root, "node_modules", "dep.txt"]), "dep")
    write_file!(Path.join([source_root, "tmp", "artifact.txt"]), "artifact")

    previous_hive_home = System.get_env("HIVE_HOME")
    System.put_env("HIVE_HOME", hive_home)

    on_exit(fn ->
      restore_env("HIVE_HOME", previous_hive_home)
      File.rm_rf!(source_root)
      File.rm_rf!(hive_home)
    end)

    assert {:ok, destination} =
             WorkspaceSnapshot.ensure_cell_workspace("cell-2", source_root, [
               "node_modules/**",
               "tmp/**"
             ])

    assert File.exists?(Path.join(destination, "keep.txt"))
    refute File.exists?(Path.join(destination, "node_modules"))
    refute File.exists?(Path.join(destination, "tmp"))
  end

  defp tmp_dir!(name) do
    path = Path.join(System.tmp_dir!(), "#{name}-#{System.unique_integer([:positive])}")
    File.mkdir_p!(path)
    path
  end

  defp write_file!(path, contents) do
    File.mkdir_p!(Path.dirname(path))
    File.write!(path, contents)
  end

  defp restore_env(key, nil), do: System.delete_env(key)
  defp restore_env(key, value), do: System.put_env(key, value)
end

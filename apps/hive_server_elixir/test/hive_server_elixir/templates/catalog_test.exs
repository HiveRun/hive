defmodule HiveServerElixir.Templates.CatalogTest do
  use HiveServerElixir.DataCase

  alias HiveServerElixir.Cells
  alias HiveServerElixir.Cells.Workspace
  alias HiveServerElixir.Templates
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

  test "list_templates returns templates, defaults, and agent defaults" do
    workspace_path = template_workspace_dir!("catalog-list")
    write_workspace_config!(workspace_path)
    write_opencode_config!(workspace_path, "opencode/big-pickle")

    workspace = workspace!(workspace_path, "Catalog Workspace")

    assert {:ok, payload} = Templates.list_templates(workspace.id)

    assert [%{id: "basic", label: "Basic Template", type: "manual"} = template] =
             payload.templates

    assert template.config_json["agent"]["providerId"] == "opencode"
    assert template.include_directories == ["apps"]
    assert payload.defaults == %{"templateId" => "basic", "startMode" => "build"}
    assert payload.agent_defaults == %{provider_id: "opencode", model_id: "big-pickle"}
  end

  test "get_template returns not_found for missing templates" do
    workspace_path = template_workspace_dir!("catalog-missing")
    write_workspace_config!(workspace_path)

    workspace = workspace!(workspace_path, "Missing Catalog Workspace")

    assert {:error, {:not_found, "Template 'missing' not found"}} =
             Templates.get_template(workspace.id, "missing")
  end

  test "list_templates uses the active workspace when workspace id is nil" do
    workspace_path = template_workspace_dir!("catalog-active")
    write_workspace_config!(workspace_path)

    workspace = workspace!(workspace_path, "Active Catalog Workspace")
    :ok = Workspaces.set_active_workspace_id(workspace.id)

    assert {:ok, payload} = Templates.list_templates(nil)
    assert [%{id: "basic"}] = payload.templates
  end

  defp workspace!(path, label) do
    assert {:ok, workspace} =
             Ash.create(
               Workspace,
               %{path: path, label: label},
               domain: Cells
             )

    workspace
  end

  defp write_workspace_config!(workspace_path) do
    config = %{
      "templates" => %{
        "basic" => %{
          "label" => "Basic Template",
          "type" => "manual",
          "agent" => %{"providerId" => "opencode"},
          "includePatterns" => ["./apps/web/**", "./.env*"]
        }
      },
      "defaults" => %{"templateId" => "basic"},
      "opencode" => %{"defaultMode" => "build"}
    }

    File.write!(Path.join(workspace_path, "hive.config.json"), Jason.encode!(config))
  end

  defp write_opencode_config!(workspace_path, model) do
    File.write!(Path.join(workspace_path, "opencode.json"), Jason.encode!(%{"model" => model}))
  end

  defp template_workspace_dir!(suffix) do
    path =
      Path.join(
        System.tmp_dir!(),
        "hive-template-catalog-#{suffix}-#{System.unique_integer([:positive])}"
      )

    File.mkdir_p!(path)

    on_exit(fn ->
      File.rm_rf!(path)
    end)

    path
  end
end

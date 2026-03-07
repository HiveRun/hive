defmodule Mix.Tasks.Opencode.SyncSpecTest do
  use ExUnit.Case, async: true

  @task "opencode.sync_spec"
  @fixture_path Path.expand("../../fixtures/opencode_spec_fixture.json", __DIR__)

  test "writes pinned openapi spec from source file" do
    output_path =
      Path.join(
        System.tmp_dir!(),
        "opencode-sync-spec-#{System.unique_integer([:positive, :monotonic])}.json"
      )

    on_exit(fn -> File.rm(output_path) end)

    Mix.Task.reenable(@task)

    Mix.Tasks.Opencode.SyncSpec.run([
      "--source",
      @fixture_path,
      "--output",
      output_path
    ])

    assert File.exists?(output_path)

    output_path
    |> File.read!()
    |> Jason.decode!()
    |> then(fn spec ->
      assert spec["openapi"] == "3.1.0"
      assert spec["info"]["title"] == "fixture"
    end)
  end
end

defmodule Mix.Tasks.Opencode.SyncSpec do
  @shortdoc "Fetches and pins the OpenCode OpenAPI spec"

  use Mix.Task

  @default_url "https://opencode.ai/openapi.json"
  @default_output "priv/opencode/openapi.json"

  @switches [url: :string, output: :string, source: :string]

  @impl Mix.Task
  def run(args) do
    Mix.Task.run("app.start")

    {opts, _, _} = OptionParser.parse(args, strict: @switches)
    output_path = opts[:output] || @default_output

    body =
      case opts[:source] do
        nil ->
          opts[:url] || System.get_env("OPENCODE_OPENAPI_URL") ||
            @default_url
            |> fetch_spec_body!()

        source_path ->
          File.read!(source_path)
      end

    spec = Jason.decode!(body)
    pretty_spec = Jason.encode_to_iodata!(spec, pretty: true)

    output_path
    |> Path.dirname()
    |> File.mkdir_p!()

    File.write!(output_path, [pretty_spec, ?\n])

    Mix.shell().info("Pinned OpenCode spec to #{output_path}")
  end

  defp fetch_spec_body!(url) do
    response = Req.get!(url: url)

    case response do
      %{status: 200, body: body} when is_binary(body) ->
        body

      %{status: 200, body: body} when is_map(body) ->
        Jason.encode!(body)

      %{status: status, body: body} ->
        raise "Failed to fetch OpenCode OpenAPI spec (status #{status}): #{inspect(body)}"
    end
  end
end

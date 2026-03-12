defmodule HiveServerElixir.TemplatesTypedController do
  use AshTypescript.TypedController

  alias HiveServerElixir.Templates
  alias HiveServerElixir.Templates.PayloadSerializer
  alias HiveServerElixirWeb.TypedControllerSupport

  typed_controller do
    module_name(HiveServerElixirWeb.TemplatesController)

    route :list_templates do
      method(:get)
      argument(:workspace_id, :string)

      run(fn conn, params ->
        case templates_payload(params, conn) do
          {:ok, payload} -> Phoenix.Controller.json(conn, payload)
          {:error, {status, message}} -> error_json(conn, status, message)
        end
      end)
    end

    route :show_template do
      method(:get)
      argument(:id, :string, allow_nil?: false)
      argument(:workspace_id, :string)

      run(fn conn, params ->
        case template_payload(params, conn) do
          {:ok, payload} -> Phoenix.Controller.json(conn, payload)
          {:error, {status, message}} -> error_json(conn, status, message)
        end
      end)
    end
  end

  defp templates_payload(params, conn) do
    with {:ok, payload} <-
           Templates.list_templates(
             TypedControllerSupport.workspace_id_from_params_or_header(params, conn)
           ) do
      {:ok, PayloadSerializer.list_payload(payload)}
    end
  end

  defp template_payload(%{id: template_id} = params, conn) do
    with {:ok, payload} <-
           Templates.get_template(
             TypedControllerSupport.workspace_id_from_params_or_header(params, conn),
             template_id
           ) do
      {:ok, PayloadSerializer.template_payload(payload)}
    end
  end

  defp error_json(conn, status, message) do
    TypedControllerSupport.json_message(conn, status, message)
  end
end

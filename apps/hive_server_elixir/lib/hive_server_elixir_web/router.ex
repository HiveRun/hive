defmodule HiveServerElixirWeb.Router do
  use HiveServerElixirWeb, :router

  import Oban.Web.Router

  pipeline :browser do
    plug(:accepts, ["html"])
    plug(:fetch_session)
    plug(:fetch_live_flash)
    plug(:put_root_layout, html: {HiveServerElixirWeb.Layouts, :root})
    plug(:protect_from_forgery)
    plug(:put_secure_browser_headers)
  end

  pipeline :api do
    plug(:accepts, ["json"])
  end

  scope "/", HiveServerElixirWeb do
    pipe_through(:api)

    get("/health", HealthController, :show)
    post("/api/cells", CellsController, :create)
    get("/api/cells/workspace/:workspace_id/stream", CellsController, :workspace_stream)
    get("/api/cells/:id/timings/stream", CellsController, :timing_stream)
    get("/api/cells/:id/setup/terminal/stream", CellsController, :setup_terminal_stream)
    post("/api/cells/:id/setup/terminal/input", CellsController, :setup_terminal_input)
    post("/api/cells/:id/setup/terminal/resize", CellsController, :setup_terminal_resize)

    get(
      "/api/cells/:id/services/:service_id/terminal/stream",
      CellsController,
      :service_terminal_stream
    )

    post(
      "/api/cells/:id/services/:service_id/terminal/input",
      CellsController,
      :service_terminal_input
    )

    post(
      "/api/cells/:id/services/:service_id/terminal/resize",
      CellsController,
      :service_terminal_resize
    )

    get("/api/cells/:id/chat/terminal/stream", CellsController, :chat_terminal_stream)
    post("/api/cells/:id/chat/terminal/input", CellsController, :chat_terminal_input)
    post("/api/cells/:id/chat/terminal/resize", CellsController, :chat_terminal_resize)
    post("/api/cells/:id/chat/terminal/restart", CellsController, :chat_terminal_restart)
    get("/api/cells/:id/resources", CellsController, :resources)
    post("/api/cells/:id/setup/retry", CellsController, :retry)
    post("/api/cells/:id/setup/resume", CellsController, :resume)
    delete("/api/cells/:id", CellsController, :delete)
    post("/rpc/run", AshTypescriptRpcController, :run)
    post("/rpc/validate", AshTypescriptRpcController, :validate)
  end

  # Other scopes may use custom stacks.
  # scope "/api", HiveServerElixirWeb do
  #   pipe_through :api
  # end

  # Enable LiveDashboard and Swoosh mailbox preview in development
  if Application.compile_env(:hive_server_elixir, :dev_routes) do
    # If you want to use the LiveDashboard in production, you should put
    # it behind authentication and allow only admins to access it.
    # If your application does not have an admins-only section yet,
    # you can use Plug.BasicAuth to set up some basic authentication
    # as long as you are also using SSL (which you should anyway).
    import Phoenix.LiveDashboard.Router

    scope "/dev" do
      pipe_through(:browser)

      live_dashboard("/dashboard", metrics: HiveServerElixirWeb.Telemetry)
      forward("/mailbox", Plug.Swoosh.MailboxPreview)
    end

    scope "/" do
      pipe_through(:browser)

      oban_dashboard("/oban")
    end
  end
end

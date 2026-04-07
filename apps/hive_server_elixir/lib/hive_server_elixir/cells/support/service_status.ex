defmodule HiveServerElixir.Cells.ServiceStatus do
  @moduledoc false

  use Ash.Type.Enum,
    values: [:stopped, :running, :error]

  @spec running?(struct() | atom() | String.t()) :: boolean()
  def running?(%{status: status}), do: running?(status)
  def running?(:running), do: true
  def running?("running"), do: true
  def running?(_status), do: false

  @spec stopped?(struct() | atom() | String.t()) :: boolean()
  def stopped?(%{status: status}), do: stopped?(status)
  def stopped?(:stopped), do: true
  def stopped?("stopped"), do: true
  def stopped?(_status), do: false

  @spec error?(struct() | atom() | String.t()) :: boolean()
  def error?(%{status: status}), do: error?(status)
  def error?(:error), do: true
  def error?("error"), do: true
  def error?(_status), do: false

  @spec derive(atom() | String.t() | nil, String.t() | nil, boolean()) ::
          {atom() | String.t() | nil, String.t() | nil}
  def derive(status, last_known_error, process_alive)

  def derive(status, last_known_error, false) when status in [:running, "running"] do
    {:error, last_known_error || "Process exited unexpectedly"}
  end

  def derive(status, _last_known_error, true) when status in [:error, "error"] do
    {:running, nil}
  end

  def derive(status, last_known_error, _process_alive), do: {status, last_known_error}

  @spec present(atom() | String.t() | nil) :: String.t() | nil
  def present(nil), do: nil
  def present(status) when is_atom(status), do: Atom.to_string(status)
  def present(status) when is_binary(status), do: status
end

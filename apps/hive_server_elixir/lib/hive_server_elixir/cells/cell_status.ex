defmodule HiveServerElixir.Cells.CellStatus do
  @moduledoc false

  use Ash.Type.Enum,
    values: [:spawning, :provisioning, :pending, :paused, :failed, :ready, :error, :deleting]

  @spec deleting?(struct() | atom() | String.t()) :: boolean()
  def deleting?(%{status: status}), do: deleting?(status)
  def deleting?(:deleting), do: true
  def deleting?("deleting"), do: true
  def deleting?(_status), do: false

  @spec ready?(struct() | atom() | String.t()) :: boolean()
  def ready?(%{status: status}), do: ready?(status)
  def ready?(:ready), do: true
  def ready?("ready"), do: true
  def ready?(_status), do: false

  @spec error?(struct() | atom() | String.t()) :: boolean()
  def error?(%{status: status}), do: error?(status)
  def error?(:error), do: true
  def error?("error"), do: true
  def error?(_status), do: false

  @spec diff_blocked?(struct() | atom() | String.t()) :: boolean()
  def diff_blocked?(%{status: status}), do: diff_blocked?(status)

  def diff_blocked?(status),
    do: status in [:spawning, :pending, :deleting, "spawning", "pending", "deleting"]

  @spec setup_state(struct() | atom() | String.t()) :: String.t()
  def setup_state(%{status: status}), do: setup_state(status)
  def setup_state(status) when status in [:ready, "ready"], do: "completed"
  def setup_state(status) when status in [:error, "error"], do: "error"
  def setup_state(_status), do: "running"

  @spec present(atom() | String.t() | nil) :: String.t() | nil
  def present(nil), do: nil
  def present(:provisioning), do: "pending"
  def present("provisioning"), do: "pending"
  def present(status) when is_atom(status), do: Atom.to_string(status)
  def present(status) when is_binary(status), do: status
end

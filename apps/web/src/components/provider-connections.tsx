import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleAlert,
  CircleCheck,
  ExternalLink,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type ProviderAuthIntegration,
  type ProviderAuthMethod,
  providerAuthMutations,
  providerAuthQueries,
} from "@/queries/provider-auth";

const OAUTH_POLL_INTERVAL_MS = 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/;

function authRefetchInterval(queryStatus: string, attemptStatus?: string) {
  return queryStatus === "error" || attemptStatus === "pending"
    ? OAUTH_POLL_INTERVAL_MS
    : false;
}

type OAuthAttempt = {
  attemptId: string;
  expiresAt: number | null;
  instructions: string;
  integrationId: string;
  mode: "auto" | "code";
  url: string;
};

type CommandAttempt = {
  attemptId: string;
  integrationId: string;
};

type ProviderAuthAnswer = Record<string, string | number | boolean | string[]>;
type ProviderAuthField = ProviderAuthMethod["fields"][number];

function defaultAnswers(fields: ProviderAuthField[]): ProviderAuthAnswer {
  return Object.fromEntries(
    fields.flatMap((field) =>
      field.default === undefined ? [] : [[field.key, field.default]]
    )
  );
}

function isFieldVisible(field: ProviderAuthField, answer: ProviderAuthAnswer) {
  return (field.when ?? []).every((condition) => {
    const matches = answer[condition.key] === condition.value;
    return condition.op === "eq" ? matches : !matches;
  });
}

function visibleFields(
  fields: ProviderAuthField[],
  answer: ProviderAuthAnswer
) {
  return fields.filter((field) => isFieldVisible(field, answer));
}

function visibleAnswers(
  fields: ProviderAuthField[],
  answer: ProviderAuthAnswer
) {
  return Object.fromEntries(
    visibleFields(fields, answer).flatMap((field) =>
      answer[field.key] === undefined ? [] : [[field.key, answer[field.key]]]
    )
  ) as ProviderAuthAnswer;
}

function matchesPattern(value: string, pattern: string) {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}

function matchesFieldFormat(
  value: string,
  format: ProviderAuthField["format"]
) {
  switch (format) {
    case "email":
      return EMAIL_PATTERN.test(value);
    case "uri":
      return URL.canParse(value);
    case "date": {
      if (!DATE_PATTERN.test(value)) {
        return false;
      }
      const parsed = new Date(`${value}T00:00:00Z`);
      return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value
      );
    }
    case "date-time": {
      const match = DATE_TIME_PATTERN.exec(value);
      if (!match) {
        return false;
      }
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const hour = Number(match[4]);
      const minute = Number(match[5]);
      const second = Number(match[6] ?? 0);
      const parsed = new Date(
        Date.UTC(year, month - 1, day, hour, minute, second)
      );
      return (
        !Number.isNaN(Date.parse(value)) &&
        parsed.getUTCFullYear() === year &&
        parsed.getUTCMonth() === month - 1 &&
        parsed.getUTCDate() === day &&
        parsed.getUTCHours() === hour &&
        parsed.getUTCMinutes() === minute &&
        parsed.getUTCSeconds() === second
      );
    }
    default:
      return true;
  }
}

function violatesFieldConstraints(
  field: ProviderAuthField,
  value: ProviderAuthAnswer[string]
) {
  if (typeof value === "string") {
    return (
      (field.minLength !== undefined && value.length < field.minLength) ||
      (field.maxLength !== undefined && value.length > field.maxLength) ||
      (field.pattern !== undefined && !matchesPattern(value, field.pattern)) ||
      !matchesFieldFormat(value, field.format)
    );
  }
  if (typeof value === "number") {
    return (
      (field.type === "integer" && !Number.isInteger(value)) ||
      (typeof field.minimum === "number" && value < field.minimum) ||
      (typeof field.maximum === "number" && value > field.maximum)
    );
  }
  if (Array.isArray(value)) {
    return (
      (field.minItems !== undefined && value.length < field.minItems) ||
      (field.maxItems !== undefined && value.length > field.maxItems)
    );
  }
  return false;
}

function hasInvalidFields(
  fields: ProviderAuthField[],
  answer: ProviderAuthAnswer
) {
  return visibleFields(fields, answer).some((field) => {
    if (field.type === "external") {
      return false;
    }
    const value = answer[field.key];
    const missing =
      value === undefined ||
      value === "" ||
      (Array.isArray(value) && value.length === 0);
    if (missing) {
      return Boolean(field.required);
    }
    return violatesFieldConstraints(field, value);
  });
}

type ProviderAuthFieldControlProps = {
  field: ProviderAuthField;
  id: string;
  value: ProviderAuthAnswer[string] | undefined;
  onChange: (value: ProviderAuthAnswer[string]) => void;
};

function ProviderAuthOptions({
  options,
}: {
  options: NonNullable<ProviderAuthField["options"]>;
}) {
  return options.map((option) => (
    <option key={option.value} value={option.value}>
      {option.label}
    </option>
  ));
}

function ProviderAuthMultiselectControl({
  field,
  id,
  value,
  onChange,
}: ProviderAuthFieldControlProps): ReactNode {
  if (field.custom) {
    return (
      <Input
        id={id}
        onChange={(event) =>
          onChange(
            event.target.value
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean)
          )
        }
        placeholder="Comma-separated values"
        value={Array.isArray(value) ? value.join(", ") : ""}
      />
    );
  }
  return (
    <select
      className="min-h-24 border-2 border-input bg-background px-3 py-2 text-sm focus-visible:outline-3 focus-visible:outline-ring"
      id={id}
      multiple
      onChange={(event) =>
        onChange(
          Array.from(event.target.selectedOptions, (option) => option.value)
        )
      }
      value={Array.isArray(value) ? value : []}
    >
      <ProviderAuthOptions options={field.options ?? []} />
    </select>
  );
}

function providerAuthInputType(field: ProviderAuthField) {
  if (field.type !== "string") {
    return "number";
  }
  const inputTypes: Record<string, string> = {
    email: "email",
    uri: "url",
    date: "date",
    "date-time": "datetime-local",
  };
  return inputTypes[field.format ?? ""] ?? "text";
}

function ProviderAuthTextControl({
  field,
  id,
  value,
  onChange,
}: ProviderAuthFieldControlProps): ReactNode {
  if (field.type === "string" && field.options?.length && !field.custom) {
    return (
      <select
        className="h-9 border-2 border-input bg-background px-3 text-sm focus-visible:outline-3 focus-visible:outline-ring"
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={typeof value === "string" ? value : ""}
      >
        <option value="">Select an option</option>
        <ProviderAuthOptions options={field.options} />
      </select>
    );
  }
  const isNumber = field.type === "number" || field.type === "integer";
  const listId =
    field.type === "string" && field.options?.length
      ? `${id}-options`
      : undefined;
  return (
    <>
      <Input
        id={id}
        list={listId}
        max={typeof field.maximum === "number" ? field.maximum : undefined}
        maxLength={field.maxLength}
        min={typeof field.minimum === "number" ? field.minimum : undefined}
        minLength={field.minLength}
        onChange={(event) => {
          if (!isNumber) {
            onChange(event.target.value);
            return;
          }
          const nextValue = event.target.value;
          onChange(nextValue === "" ? "" : Number(nextValue));
        }}
        pattern={field.pattern}
        placeholder={field.placeholder}
        step={field.type === "integer" ? 1 : undefined}
        type={providerAuthInputType(field)}
        value={
          typeof value === "string" || typeof value === "number" ? value : ""
        }
      />
      {listId ? (
        <datalist id={listId}>
          <ProviderAuthOptions options={field.options ?? []} />
        </datalist>
      ) : null}
    </>
  );
}

function ProviderAuthFieldControl(
  props: ProviderAuthFieldControlProps
): ReactNode {
  if (props.field.type === "boolean") {
    return (
      <input
        checked={props.value === true}
        className="size-4 accent-primary"
        id={props.id}
        onChange={(event) => props.onChange(event.target.checked)}
        type="checkbox"
      />
    );
  }
  if (props.field.type === "multiselect") {
    return <ProviderAuthMultiselectControl {...props} />;
  }
  return <ProviderAuthTextControl {...props} />;
}

function ProviderAuthFieldInput({
  field,
  idPrefix,
  value,
  onChange,
}: {
  field: ProviderAuthField;
  idPrefix: string;
  value: ProviderAuthAnswer[string] | undefined;
  onChange: (value: ProviderAuthAnswer[string]) => void;
}) {
  const id = `provider-auth-${idPrefix}-${field.key}`;
  if (field.type === "external") {
    return (
      <Button asChild type="button" variant="outline">
        <a href={field.url} rel="noreferrer" target="_blank">
          <ExternalLink className="size-4" />
          {field.title ?? "Open provider instructions"}
        </a>
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{field.title ?? field.key}</Label>
      <ProviderAuthFieldControl
        field={field}
        id={id}
        onChange={onChange}
        value={value}
      />
      {field.description ? (
        <p className="text-muted-foreground text-xs">{field.description}</p>
      ) : null}
    </div>
  );
}

function CancelAttemptButton({
  disabled,
  onCancel,
}: {
  disabled: boolean;
  onCancel: () => void;
}) {
  return (
    <Button
      disabled={disabled}
      onClick={onCancel}
      size="sm"
      type="button"
      variant="ghost"
    >
      Cancel
    </Button>
  );
}

function selectVisibleIntegrations(
  integrations: ProviderAuthIntegration[] | undefined,
  providerId: string | undefined,
  integrationId: string | null | undefined,
  configuredIntegrationIds: Set<string>
) {
  if (!providerId) {
    const visible =
      integrations?.filter(
        (integration) =>
          integration.connected || configuredIntegrationIds.has(integration.id)
      ) ?? [];
    return [...visible].sort(
      (left, right) => Number(right.connected) - Number(left.connected)
    );
  }
  if (!integrationId) {
    return [];
  }
  return integrations?.filter(({ id }) => id === integrationId) ?? [];
}

export function ProviderConnections({
  workspaceId,
  providerId,
  compact = false,
  onReadyChange,
}: {
  workspaceId: string;
  providerId?: string;
  compact?: boolean;
  onReadyChange?: (ready: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const authQuery = useQuery(providerAuthQueries.byWorkspace(workspaceId));
  const provider = authQuery.data?.providers.find(
    (candidate) => candidate.id === providerId
  );
  const configuredIntegrationIds = new Set(
    authQuery.data?.providers.flatMap(({ integrationId }) =>
      integrationId ? [integrationId] : []
    )
  );
  const visibleIntegrations = selectVisibleIntegrations(
    authQuery.data?.integrations,
    providerId,
    provider?.integrationId,
    configuredIntegrationIds
  );
  const ready = Boolean(
    !(authQuery.isPending || authQuery.isError) &&
      (!(providerId && provider) || provider.state !== "missing")
  );

  useEffect(() => {
    onReadyChange?.(ready);
  }, [onReadyChange, ready]);

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: providerAuthQueries.byWorkspace(workspaceId).queryKey,
    });

  if (authQuery.isPending) {
    return (
      <div className="flex items-center gap-2 border-2 border-border bg-muted/20 p-3 text-muted-foreground text-xs">
        <Loader2 className="size-4 animate-spin" />
        Checking provider connection
      </div>
    );
  }

  if (authQuery.isError) {
    return (
      <div className="flex items-center justify-between gap-3 border-2 border-destructive bg-destructive/10 p-3 text-destructive text-xs">
        <span className="flex items-center gap-2">
          <CircleAlert className="size-4" />
          {authQuery.error.message}
        </span>
        <Button onClick={refresh} size="sm" type="button" variant="outline">
          Retry
        </Button>
      </div>
    );
  }

  if (providerId && provider?.state === "not_required") {
    return compact ? null : (
      <div className="flex items-center gap-2 border-2 border-emerald-500 bg-emerald-500/10 p-3 text-emerald-400 text-xs">
        <ShieldCheck className="size-4" />
        {provider.name} does not require a stored connection.
      </div>
    );
  }

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      {providerId && provider?.state === "missing" ? (
        <div className="flex items-start gap-3 border-2 border-amber-500 bg-amber-500/10 p-3 text-amber-200 text-xs">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            Connect {provider.name} before creating this cell. Hive checks this
            again before OpenCode creates the agent session.
          </span>
        </div>
      ) : null}

      {visibleIntegrations.length === 0 ? (
        <div className="border-2 border-border bg-muted/20 p-4 text-muted-foreground text-sm">
          No configurable provider connections were reported for this workspace.
        </div>
      ) : (
        visibleIntegrations.map((integration) => (
          <ProviderConnection
            integration={integration}
            key={`${workspaceId}:${integration.id}`}
            onConnected={refresh}
            workspaceId={workspaceId}
          />
        ))
      )}

      {compact ? null : (
        <Button onClick={refresh} type="button" variant="outline">
          <RefreshCw className="size-4" />
          Refresh connections
        </Button>
      )}
    </div>
  );
}

function ProviderConnection({
  integration,
  workspaceId,
  onConnected,
}: {
  integration: ProviderAuthIntegration;
  workspaceId: string;
  onConnected: () => void;
}) {
  const [showAuthControls, setShowAuthControls] = useState(
    !integration.connected
  );
  const [oauthAttempt, setOAuthAttempt] = useState<OAuthAttempt | null>(null);
  const [commandAttempt, setCommandAttempt] = useState<CommandAttempt | null>(
    null
  );
  const [oauthStarting, setOAuthStarting] = useState(false);
  const [commandStarting, setCommandStarting] = useState(false);
  const keyMethod = integration.methods.find((method) => method.type === "key");
  const oauthMethods = integration.methods.filter(
    (method): method is ProviderAuthMethod & { type: "oauth"; id: string } =>
      method.type === "oauth" && Boolean(method.id)
  );
  const commandMethods = integration.methods.filter(
    (method): method is ProviderAuthMethod & { type: "command"; id: string } =>
      method.type === "command" && Boolean(method.id)
  );
  const envMethod = integration.methods.find((method) => method.type === "env");
  const keyForm = useForm({
    defaultValues: {
      key: "",
      answer: defaultAnswers(keyMethod?.fields ?? []),
    },
    onSubmit: () => keyMutation.mutateAsync(),
  });
  const authForm = useForm({ defaultValues: { code: "" } });
  const finishConnection = useCallback(() => {
    toast.success(`${integration.name} connected`);
    setOAuthAttempt(null);
    setCommandAttempt(null);
    setShowAuthControls(false);
    keyForm.reset();
    authForm.reset();
    onConnected();
  }, [authForm, integration.name, keyForm, onConnected]);
  const keyMutation = useMutation({
    mutationFn: () =>
      providerAuthMutations.connectKey.mutationFn({
        workspaceId,
        integrationId: integration.id,
        key: keyForm.state.values.key.trim(),
        answer: visibleAnswers(
          keyMethod?.fields ?? [],
          keyForm.state.values.answer
        ),
      }),
    onSuccess: finishConnection,
    onError: (error) => toast.error(error.message),
  });
  const completeOAuthMutation = useMutation({
    mutationFn: () => {
      if (!oauthAttempt) {
        throw new Error("Provider authentication attempt is unavailable");
      }
      return providerAuthMutations.completeOAuth.mutationFn({
        workspaceId,
        integrationId: integration.id,
        attemptId: oauthAttempt.attemptId,
        code: authForm.state.values.code.trim(),
      });
    },
    onSuccess: finishConnection,
    onError: (error) => toast.error(error.message),
  });
  const startCommandMutation = useMutation({
    mutationFn: providerAuthMutations.startCommand.mutationFn,
    onSuccess: (attempt) =>
      setCommandAttempt({
        attemptId: attempt.attemptId,
        integrationId: integration.id,
      }),
    onError: (error) => toast.error(error.message),
  });
  const cancelCommandMutation = useMutation({
    mutationFn: providerAuthMutations.cancelCommand.mutationFn,
    onSuccess: () => setCommandAttempt(null),
    onError: (error) => toast.error(error.message),
  });
  const cancelOAuthMutation = useMutation({
    mutationFn: providerAuthMutations.cancelOAuth.mutationFn,
    onSuccess: () => setOAuthAttempt(null),
    onError: (error) => toast.error(error.message),
  });
  const oauthStatus = useQuery({
    ...providerAuthQueries.oauthStatus(
      workspaceId,
      integration.id,
      oauthAttempt?.attemptId ?? "pending"
    ),
    enabled: Boolean(oauthAttempt),
    refetchInterval: (query) =>
      authRefetchInterval(query.state.status, query.state.data?.status),
  });
  const commandStatus = useQuery({
    ...providerAuthQueries.commandStatus(
      workspaceId,
      integration.id,
      commandAttempt?.attemptId ?? "pending"
    ),
    enabled: Boolean(commandAttempt),
    refetchInterval: (query) =>
      authRefetchInterval(query.state.status, query.state.data?.status),
  });

  const closeAuthControls = () => {
    keyForm.reset();
    authForm.reset();
    setShowAuthControls(false);
  };

  useEffect(() => {
    if (integration.connected) {
      setShowAuthControls(false);
    }
  }, [integration.connected]);

  useEffect(() => {
    if (oauthStatus.data?.status === "complete") {
      finishConnection();
    } else if (oauthStatus.data?.status === "failed") {
      toast.error(
        oauthStatus.data.message ?? `${integration.name} authentication failed`
      );
      setOAuthAttempt(null);
    } else if (oauthStatus.data?.status === "expired") {
      toast.error(`${integration.name} authentication expired`);
      setOAuthAttempt(null);
    }
  }, [integration.name, oauthStatus.data, finishConnection]);

  useEffect(() => {
    if (commandStatus.data?.status === "complete") {
      finishConnection();
    } else if (commandStatus.data?.status === "failed") {
      toast.error(
        commandStatus.data.message ?? `${integration.name} connection failed`
      );
      setCommandAttempt(null);
    } else if (commandStatus.data?.status === "expired") {
      toast.error(`${integration.name} connection expired`);
      setCommandAttempt(null);
    }
  }, [commandStatus.data, finishConnection, integration.name]);

  if (integration.connected && !showAuthControls) {
    return (
      <div className="flex items-center justify-between gap-3 border-2 border-emerald-500 bg-emerald-500/10 p-4">
        <div className="flex items-center gap-3">
          <CircleCheck className="size-5 text-emerald-400" />
          <div>
            <p className="font-semibold uppercase tracking-[0.08em]">
              {integration.name}
            </p>
            <p className="text-muted-foreground text-xs">
              {integration.connectionLabels.join(", ") || "Connected"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">Connected</Badge>
          <Button
            onClick={() => setShowAuthControls(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            Reconnect
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 border-2 border-amber-500 bg-amber-500/5 p-4">
      <ProviderConfigurationHeader
        closeDisabled={Boolean(
          oauthStarting ||
            commandStarting ||
            oauthAttempt ||
            commandAttempt ||
            keyMutation.isPending ||
            startCommandMutation.isPending
        )}
        integration={integration}
        onClose={closeAuthControls}
      />

      {keyMethod ? (
        <div className="space-y-3">
          <keyForm.Subscribe selector={(state) => state.values}>
            {(values) => (
              <>
                {visibleFields(keyMethod.fields, values.answer).map(
                  (methodField) => (
                    <ProviderAuthFieldInput
                      field={methodField}
                      idPrefix={`${integration.id}-key`}
                      key={methodField.key}
                      onChange={(value) =>
                        keyForm.setFieldValue("answer", {
                          ...values.answer,
                          [methodField.key]: value,
                        })
                      }
                      value={values.answer[methodField.key]}
                    />
                  )
                )}
                <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                  <keyForm.Field name="key">
                    {(field) => (
                      <div className="space-y-2">
                        <Label htmlFor={`${integration.id}-key`}>
                          {keyMethod.label}
                        </Label>
                        <Input
                          autoComplete="off"
                          id={`${integration.id}-key`}
                          onBlur={field.handleBlur}
                          onChange={(event) =>
                            field.handleChange(event.target.value)
                          }
                          placeholder="Paste credential"
                          type="password"
                          value={field.state.value}
                        />
                      </div>
                    )}
                  </keyForm.Field>
                  <Button
                    disabled={
                      keyMutation.isPending ||
                      values.key.trim() === "" ||
                      hasInvalidFields(keyMethod.fields, values.answer)
                    }
                    onClick={() => keyForm.handleSubmit()}
                    type="button"
                  >
                    {keyMutation.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <KeyRound className="size-4" />
                    )}
                    Connect key
                  </Button>
                </div>
              </>
            )}
          </keyForm.Subscribe>
        </div>
      ) : null}

      {oauthMethods.map((method) => (
        <OAuthMethodForm
          disabled={Boolean(
            oauthStarting ||
              commandStarting ||
              oauthAttempt ||
              commandAttempt ||
              startCommandMutation.isPending
          )}
          integrationId={integration.id}
          key={method.id}
          method={method}
          onStarted={(attempt) =>
            setOAuthAttempt({
              ...attempt,
              integrationId: integration.id,
            })
          }
          onStartingChange={setOAuthStarting}
          workspaceId={workspaceId}
        />
      ))}

      {commandMethods.map((method) => (
        <Button
          disabled={
            Boolean(oauthStarting || oauthAttempt || commandAttempt) ||
            commandStarting ||
            startCommandMutation.isPending
          }
          key={method.id}
          onClick={() => {
            setCommandStarting(true);
            startCommandMutation.mutate(
              {
                workspaceId,
                integrationId: integration.id,
                methodId: method.id,
              },
              {
                onSettled: () => setCommandStarting(false),
              }
            );
          }}
          type="button"
          variant="outline"
        >
          {startCommandMutation.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ShieldCheck className="size-4" />
          )}
          {method.label}
        </Button>
      ))}

      {oauthAttempt ? (
        <div className="space-y-3 border-primary border-l-4 bg-background/60 p-3">
          <p className="text-sm">{oauthAttempt.instructions}</p>
          <Button asChild type="button" variant="outline">
            <a href={oauthAttempt.url} rel="noreferrer" target="_blank">
              <ExternalLink className="size-4" />
              Open authorization
            </a>
          </Button>
          {oauthAttempt.mode === "code" ? (
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <authForm.Field name="code">
                {(field) => (
                  <Input
                    aria-label="Authorization code"
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="Authorization code"
                    value={field.state.value}
                  />
                )}
              </authForm.Field>
              <Button
                disabled={completeOAuthMutation.isPending}
                onClick={() => completeOAuthMutation.mutate()}
                type="button"
              >
                Complete
              </Button>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-muted-foreground text-xs">
              <Loader2 className="size-3 animate-spin" /> Waiting for OpenCode
            </p>
          )}
          <CancelAttemptButton
            disabled={cancelOAuthMutation.isPending}
            onCancel={() =>
              cancelOAuthMutation.mutate({
                workspaceId,
                integrationId: integration.id,
                attemptId: oauthAttempt.attemptId,
              })
            }
          />
        </div>
      ) : null}

      {commandAttempt ? (
        <div className="space-y-3 border-primary border-l-4 bg-background/60 p-3">
          <p className="flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            {commandStatus.data?.message ??
              "Complete the provider connection in the opened command."}
          </p>
          <CancelAttemptButton
            disabled={cancelCommandMutation.isPending}
            onCancel={() =>
              cancelCommandMutation.mutate({
                workspaceId,
                integrationId: commandAttempt.integrationId,
                attemptId: commandAttempt.attemptId,
              })
            }
          />
        </div>
      ) : null}

      {envMethod?.environmentVariables?.length ? (
        <p className="font-mono text-muted-foreground text-xs">
          Environment alternative: {envMethod.environmentVariables.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

function ProviderConfigurationHeader({
  closeDisabled,
  integration,
  onClose,
}: {
  closeDisabled: boolean;
  integration: ProviderAuthIntegration;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="font-semibold uppercase tracking-[0.08em]">
          {integration.name}
        </p>
        <p className="text-muted-foreground text-xs">
          Choose a connection method
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="outline">Configure</Badge>
        {integration.connected ? (
          <Button
            disabled={closeDisabled}
            onClick={onClose}
            size="sm"
            type="button"
            variant="ghost"
          >
            Close
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function OAuthMethodForm({
  workspaceId,
  integrationId,
  method,
  disabled,
  onStarted,
  onStartingChange,
}: {
  workspaceId: string;
  integrationId: string;
  method: ProviderAuthMethod & { type: "oauth"; id: string };
  disabled: boolean;
  onStarted: (attempt: Omit<OAuthAttempt, "integrationId">) => void;
  onStartingChange: (starting: boolean) => void;
}) {
  const form = useForm({
    defaultValues: { answer: defaultAnswers(method.fields) },
    onSubmit: async () => {
      onStartingChange(true);
      await mutation.mutateAsync().finally(() => onStartingChange(false));
    },
  });
  const mutation = useMutation({
    mutationFn: () =>
      providerAuthMutations.startOAuth.mutationFn({
        workspaceId,
        integrationId,
        methodId: method.id,
        answer: visibleAnswers(method.fields, form.state.values.answer),
      }),
    onSuccess: (attempt) => {
      form.reset();
      onStarted(attempt);
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="space-y-3">
      <form.Subscribe selector={(state) => state.values.answer}>
        {(answer) => (
          <>
            {visibleFields(method.fields, answer).map((methodField) => (
              <ProviderAuthFieldInput
                field={methodField}
                idPrefix={`${integrationId}-${method.id}`}
                key={methodField.key}
                onChange={(value) =>
                  form.setFieldValue("answer", {
                    ...answer,
                    [methodField.key]: value,
                  })
                }
                value={answer[methodField.key]}
              />
            ))}
            <Button
              disabled={
                disabled ||
                mutation.isPending ||
                hasInvalidFields(method.fields, answer)
              }
              onClick={() => form.handleSubmit()}
              type="button"
              variant="outline"
            >
              {mutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ShieldCheck className="size-4" />
              )}
              {method.label}
            </Button>
          </>
        )}
      </form.Subscribe>
    </div>
  );
}

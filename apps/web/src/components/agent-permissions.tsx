import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { PermissionRequest } from "@/hooks/use-agent-event-stream";
import { agentMutations } from "@/queries/agents";

type AgentPermissionsProps = {
  permissions: PermissionRequest[];
  sessionId: string;
};

export function AgentPermissions({
  permissions,
  sessionId,
}: AgentPermissionsProps) {
  const respondPermissionMutation = useMutation({
    ...agentMutations.respondPermission,
    onSuccess: () => {
      toast.success("Permission response sent");
    },
    onError: (error) => {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to respond to permission";
      toast.error(errorMessage);
    },
  });

  const handlePermissionResponse = (
    permissionId: string,
    response: "once" | "always" | "reject"
  ) => {
    respondPermissionMutation.mutate({
      sessionId,
      permissionId,
      response,
    });
  };

  if (permissions.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3 rounded-md border border-dashed p-4">
      <div className="space-y-1">
        <p className="font-medium text-sm">Agent Permissions</p>
        <p className="text-muted-foreground text-xs">
          The agent needs approval to continue. Review each request below.
        </p>
      </div>
      {permissions.map((permission) => (
        <div
          className="rounded-md border bg-muted/40 p-3 text-sm"
          key={permission.id}
        >
          <p className="font-semibold">{permission.title}</p>
          <p className="text-muted-foreground text-xs">
            {permission.type}
            {permission.pattern
              ? ` · ${Array.isArray(permission.pattern) ? permission.pattern.join(", ") : permission.pattern}`
              : ""}
          </p>
          {permission.metadata && (
            <pre className="mt-2 max-h-32 overflow-auto rounded bg-background p-2 text-xs">
              {JSON.stringify(permission.metadata, null, 2)}
            </pre>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              disabled={respondPermissionMutation.isPending}
              onClick={() => handlePermissionResponse(permission.id, "once")}
              size="sm"
              variant="secondary"
            >
              Allow Once
            </Button>
            <Button
              disabled={respondPermissionMutation.isPending}
              onClick={() => handlePermissionResponse(permission.id, "always")}
              size="sm"
              variant="secondary"
            >
              Always Allow
            </Button>
            <Button
              disabled={respondPermissionMutation.isPending}
              onClick={() => handlePermissionResponse(permission.id, "reject")}
              size="sm"
              variant="destructive"
            >
              Reject
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

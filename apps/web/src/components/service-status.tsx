import {
  Activity,
  Copy,
  Cpu,
  HardDrive,
  Play,
  RotateCcw,
  Square,
  Terminal,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ServiceStatus } from "@/types/service";

type ServiceStatusProps = {
  service: ServiceStatus;
  onStart?: () => void;
  onStop?: () => void;
  onRestart?: () => void;
  onCopyCommand?: () => void;
};

export function ServiceStatusCard({
  service,
  onStart,
  onStop,
  onRestart,
  onCopyCommand,
}: ServiceStatusProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case "running":
        return "bg-green-500";
      case "stopped":
        return "bg-gray-500";
      case "needs_resume":
        return "bg-yellow-500";
      case "error":
        return "bg-red-500";
      default:
        return "bg-gray-500";
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "running":
        return "Running";
      case "stopped":
        return "Stopped";
      case "needs_resume":
        return "Needs Resume";
      case "error":
        return "Error";
      default:
        return "Unknown";
    }
  };

  const getHealthColor = (health: string) => {
    switch (health) {
      case "healthy":
        return "text-green-600";
      case "unhealthy":
        return "text-red-600";
      default:
        return "text-gray-600";
    }
  };

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="font-mono text-sm">
          {service.serviceName}
        </CardTitle>
        <div className="flex items-center space-x-2">
          <Badge
            className={`${getStatusColor(service.status)} text-white`}
            variant="secondary"
          >
            {getStatusText(service.status)}
          </Badge>
          {service.status === "running" && (
            <Badge
              className={getHealthColor(service.healthStatus)}
              variant="outline"
            >
              <Activity className="mr-1 h-3 w-3" />
              {service.healthStatus}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-muted-foreground text-sm">
          <div className="flex items-center space-x-2">
            <Terminal className="h-4 w-4" />
            <span className="font-mono text-xs">{service.serviceType}</span>
          </div>
          {service.command && (
            <div className="mt-1 truncate rounded bg-muted p-2 font-mono text-xs">
              {service.command}
            </div>
          )}
        </div>

        {service.status === "running" && (
          <div className="grid grid-cols-2 gap-4 text-sm">
            {service.cpuUsage && (
              <div className="flex items-center space-x-2">
                <Cpu className="h-4 w-4 text-muted-foreground" />
                <span>CPU: {service.cpuUsage}</span>
              </div>
            )}
            {service.memoryUsage && (
              <div className="flex items-center space-x-2">
                <HardDrive className="h-4 w-4 text-muted-foreground" />
                <span>Memory: {service.memoryUsage}</span>
              </div>
            )}
          </div>
        )}

        {service.ports && Object.keys(service.ports).length > 0 && (
          <div className="text-sm">
            <div className="mb-1 font-medium">Ports:</div>
            <div className="flex flex-wrap gap-1">
              {Object.entries(service.ports).map(([name, port]) => (
                <Badge
                  className="font-mono text-xs"
                  key={name}
                  variant="outline"
                >
                  {name}: {port}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <div className="flex space-x-2 pt-2">
          {service.status === "running" ? (
            <>
              <Button
                className="flex items-center space-x-1"
                onClick={onStop}
                size="sm"
                variant="outline"
              >
                <Square className="h-3 w-3" />
                <span>Stop</span>
              </Button>
              <Button
                className="flex items-center space-x-1"
                onClick={onRestart}
                size="sm"
                variant="outline"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Restart</span>
              </Button>
            </>
          ) : (
            <Button
              className="flex items-center space-x-1"
              onClick={onStart}
              size="sm"
            >
              <Play className="h-3 w-3" />
              <span>Start</span>
            </Button>
          )}

          {service.command && (
            <Button
              className="flex items-center space-x-1"
              onClick={onCopyCommand}
              size="sm"
              variant="ghost"
            >
              <Copy className="h-3 w-3" />
              <span>Copy Command</span>
            </Button>
          )}
        </div>

        {service.errorMessage && (
          <div className="rounded bg-red-50 p-2 text-red-600 text-sm">
            <div className="font-medium">Error:</div>
            <div className="text-xs">{service.errorMessage}</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

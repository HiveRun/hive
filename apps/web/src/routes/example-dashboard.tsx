import { createFileRoute } from "@tanstack/react-router";

import data from "@/app/example-dashboard/data.json";
import { ChartAreaInteractive } from "@/components/chart-area-interactive";
import {
  DataTable,
  schema as dashboardRowSchema,
} from "@/components/data-table";
import { SectionCards } from "@/components/section-cards";

const dashboardData = dashboardRowSchema.array().parse(data);

export const Route = createFileRoute("/example-dashboard")({
  component: DashboardRoute,
});

function DashboardRoute() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
          <SectionCards />
          <div className="px-4 lg:px-6">
            <ChartAreaInteractive />
          </div>
          <DataTable data={dashboardData} />
        </div>
      </div>
    </div>
  );
}

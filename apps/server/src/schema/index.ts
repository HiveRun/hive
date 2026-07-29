import { cellActivityEvents } from "./activity-events";
import { cellProvisioningStates } from "./cell-provisioning";
import { cells } from "./cells";
import { linearIntegrations } from "./linear-integrations";
import { cellServicePorts, cellServices } from "./services";
import { cellTimingEvents } from "./timing-events";

export const schema = {
  cells,
  cellServices,
  cellServicePorts,
  cellProvisioningStates,
  cellActivityEvents,
  cellTimingEvents,
  linearIntegrations,
};

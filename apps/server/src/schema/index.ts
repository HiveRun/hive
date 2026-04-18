import { cellActivityEvents } from "./activity-events";
import { cellProvisioningStates } from "./cell-provisioning";
import { cells } from "./cells";
import { linearIntegrations } from "./linear-integrations";
import { cellResourceHistory, cellResourceRollups } from "./resource-history";
import { cellServices } from "./services";
import { cellTimingEvents } from "./timing-events";

export const schema = {
  cells,
  cellServices,
  cellResourceHistory,
  cellResourceRollups,
  cellProvisioningStates,
  cellActivityEvents,
  cellTimingEvents,
  linearIntegrations,
};

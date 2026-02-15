import { cellActivityEvents } from "./activity-events";
import { cellProvisioningStates } from "./cell-provisioning";
import { cells } from "./cells";
import { cellServices } from "./services";
import { cellTimingEvents } from "./timing-events";

export const schema = {
  cells,
  cellServices,
  cellProvisioningStates,
  cellActivityEvents,
  cellTimingEvents,
};

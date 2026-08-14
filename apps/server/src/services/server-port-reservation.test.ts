import { createConnection } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  releaseServerPort,
  reserveServerPort,
  type ServerPortReservation,
} from "./server-port-reservation";

describe("server port reservation", () => {
  const reservations: ServerPortReservation[] = [];

  const getReservationPort = (reservation: ServerPortReservation): number => {
    const address = reservation.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected a TCP server address");
    }
    return address.port;
  };

  afterEach(async () => {
    await Promise.all(reservations.splice(0).map(releaseServerPort));
  });

  it("rejects a second server before bootstrap can begin", async () => {
    const reservation = await reserveServerPort(0, "127.0.0.1");
    reservations.push(reservation);

    await expect(
      reserveServerPort(getReservationPort(reservation), "127.0.0.1")
    ).rejects.toMatchObject({ code: "EADDRINUSE" });
  });

  it("releases promptly after a client probes the reserved port", async () => {
    const reservation = await reserveServerPort(0, "127.0.0.1");

    const clientClosed = new Promise<void>((resolve) => {
      const client = createConnection(
        getReservationPort(reservation),
        "127.0.0.1"
      );
      client.once("close", resolve);
    });
    await clientClosed;

    await releaseServerPort(reservation);
  });
});

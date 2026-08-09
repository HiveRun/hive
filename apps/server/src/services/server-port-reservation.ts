import { createServer, type Server } from "node:net";

export type ServerPortReservation = Server;

export const reserveServerPort = (
  port: number,
  hostname: string
): Promise<ServerPortReservation> =>
  new Promise((resolve, reject) => {
    const reservation = createServer((socket) => socket.destroy());
    reservation.once("error", reject);
    reservation.listen({ port, host: hostname, exclusive: true }, () => {
      reservation.removeListener("error", reject);
      resolve(reservation);
    });
  });

export const releaseServerPort = (
  reservation: ServerPortReservation
): Promise<void> =>
  new Promise((resolve, reject) => {
    reservation.close((error) => (error ? reject(error) : resolve()));
  });

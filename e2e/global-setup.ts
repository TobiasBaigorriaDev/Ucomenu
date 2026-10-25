import { startMuxStub } from "./mux-stub";
import { pauseQrResetJob } from "../tests/cron-local";

/** Levanta el Mux de mentira una vez por corrida (ficha videos-mux-parte-b) y lo apaga al terminar. */
export default async function globalSetup() {
  const stub = await startMuxStub();
  let restoreCron: () => void;
  try { restoreCron = pauseQrResetJob(); } catch (error) { await stub.close(); throw error; }
  return async () => {
    try { restoreCron(); } finally { await stub.close(); }
  };
}

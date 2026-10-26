import { startGeminiStub } from "./gemini-stub";
import { startMuxStub } from "./mux-stub";
import { pauseQrResetJob } from "../tests/cron-local";

/** Levanta el Mux de mentira una vez por corrida (ficha videos-mux-parte-b) y lo apaga al terminar. */
export default async function globalSetup() {
  const stub = await startMuxStub();
  const gemini = await startGeminiStub().catch(async (error) => {
    await stub.close();
    throw error;
  });
  let restoreCron: () => void;
  try { restoreCron = pauseQrResetJob(); } catch (error) { await Promise.all([stub.close(), gemini.close()]); throw error; }
  return async () => {
    try { restoreCron(); } finally { await Promise.all([stub.close(), gemini.close()]); }
  };
}

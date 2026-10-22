import { startMuxStub } from "./mux-stub";

/** Levanta el Mux de mentira una vez por corrida (ficha videos-mux-parte-b) y lo apaga al terminar. */
export default async function globalSetup() {
  const stub = await startMuxStub();
  return async () => {
    await stub.close();
  };
}

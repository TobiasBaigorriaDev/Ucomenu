import type { MuxClient } from "@/lib/videos/mux";

/**
 * Un Mux de mentira para las pruebas de integración: anota cada llamada y puede fallar a pedido. Es el doble de
 * `MuxClient`; la API real se probó aparte (ficha videos-mux-parte-b).
 */
export type FakeMux = {
  mux: MuxClient;
  /** Assets que se pidió borrar, en orden. */
  deletedAssets: string[];
  /** Subidas que se pidió cancelar, en orden. */
  cancelledUploads: string[];
  /** Subidas que se pidió crear (con el `passthrough` que viajó). */
  createdUploads: { corsOrigin: string; passthrough: string; uploadId: string }[];
  /** Hace fallar la próxima llamada (o todas, si `siempre`). */
  fail: (what: "create" | "cancel" | "delete", siempre?: boolean) => void;
};

export function fakeMux(): FakeMux {
  const state = { failing: new Set<string>(), always: new Set<string>() };
  const fake: FakeMux = {
    deletedAssets: [],
    cancelledUploads: [],
    createdUploads: [],
    fail: (what, siempre = false) => {
      state.failing.add(what);
      if (siempre) state.always.add(what);
    },
    mux: {
      async createDirectUpload({ corsOrigin, passthrough }) {
        if (state.failing.has("create")) {
          if (!state.always.has("create")) state.failing.delete("create");
          throw new Error("Mux no responde (crear)");
        }
        const uploadId = `up-fake-${fake.createdUploads.length + 1}-${Math.random().toString(36).slice(2, 8)}`;
        fake.createdUploads.push({ corsOrigin, passthrough, uploadId });
        return { uploadId, url: `https://upload.example.test/${uploadId}` };
      },
      async cancelUpload(uploadId) {
        if (state.failing.has("cancel")) {
          if (!state.always.has("cancel")) state.failing.delete("cancel");
          throw new Error("Mux no responde (cancelar)");
        }
        fake.cancelledUploads.push(uploadId);
      },
      async deleteAsset(assetId) {
        if (state.failing.has("delete")) {
          if (!state.always.has("delete")) state.failing.delete("delete");
          throw new Error("Mux no responde (borrar)");
        }
        fake.deletedAssets.push(assetId);
      },
    },
  };
  return fake;
}

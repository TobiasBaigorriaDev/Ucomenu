import { afterEach, describe, expect, it, vi } from "vitest";
import { asegurarDestinoLocal, daemonEfectivo, esContenedorDePruebas, esDaemonDockerLocal } from "../rls/purge-price-history";

// Sin base ni Docker real: solo la decisión de si el destino de la limpieza es local.

describe("destino de la limpieza del historial de precios", () => {
  afterEach(() => vi.unstubAllEnvs());

  const LOCAL = "npipe:////./pipe/dockerDesktopLinuxEngine";
  // Contextos simulados: nunca se consulta a Docker.
  const contextos: Record<string, string> = { local: LOCAL, remoto: "ssh://usuario@servidor-remoto" };
  const inspeccionar = (nombre?: string) => contextos[nombre ?? "local"] ?? "";

  it("acepta los daemons locales", () => {
    expect(esDaemonDockerLocal("npipe:////./pipe/dockerDesktopLinuxEngine")).toBe(true);
    expect(esDaemonDockerLocal("unix:///var/run/docker.sock")).toBe(true);
    expect(esDaemonDockerLocal("tcp://localhost:2375")).toBe(true);
    expect(esDaemonDockerLocal("tcp://127.0.0.1:2375")).toBe(true);
    expect(esDaemonDockerLocal("tcp://[::1]:2375")).toBe(true);
  });

  it("rechaza daemons remotos, ssh o vacíos", () => {
    expect(esDaemonDockerLocal("ssh://usuario@servidor")).toBe(false);
    expect(esDaemonDockerLocal("tcp://10.0.0.5:2375")).toBe(false);
    expect(esDaemonDockerLocal("tcp://produccion.example.com:2376")).toBe(false);
    expect(esDaemonDockerLocal("tcp://localhost.evil.example.com:2375")).toBe(false);
    expect(esDaemonDockerLocal("")).toBe(false);
  });

  it("solo acepta contenedores de base de Supabase local", () => {
    expect(esContenedorDePruebas("supabase_db_ucomenu")).toBe(true);
    expect(esContenedorDePruebas("supabase_db_ucomenu-precios")).toBe(true);
    expect(esContenedorDePruebas("supabase_auth_ucomenu")).toBe(false);
    expect(esContenedorDePruebas("postgres-produccion")).toBe(false);
    expect(esContenedorDePruebas("supabase_db_")).toBe(false);
    expect(esContenedorDePruebas("supabase_db_x; rm -rf /")).toBe(false);
  });

  it("antes de ejecutar SQL rechaza un DOCKER_HOST remoto aunque el contenedor sea válido", () => {
    vi.stubEnv("DOCKER_CONTEXT", "");
    vi.stubEnv("DOCKER_HOST", "ssh://usuario@servidor-remoto");
    expect(() => asegurarDestinoLocal("supabase_db_ucomenu")).toThrow(/solo corre contra el Docker local/);
    vi.stubEnv("DOCKER_HOST", "tcp://10.1.2.3:2375");
    expect(() => asegurarDestinoLocal("supabase_db_ucomenu")).toThrow(/Docker local/);
  });

  it("DOCKER_CONTEXT anula a DOCKER_HOST (precedencia de Docker)", () => {
    expect(daemonEfectivo({ DOCKER_HOST: "tcp://127.0.0.1:2375", DOCKER_CONTEXT: "remoto" }, inspeccionar)).toBe(contextos.remoto);
    expect(daemonEfectivo({ DOCKER_HOST: "tcp://127.0.0.1:2375" }, inspeccionar)).toBe("tcp://127.0.0.1:2375");
    expect(daemonEfectivo({}, inspeccionar)).toBe(LOCAL);
  });

  it("con DOCKER_HOST local y un DOCKER_CONTEXT remoto se rechaza (la purga iría al contexto remoto)", () => {
    const entorno = { DOCKER_HOST: "tcp://127.0.0.1:2375", DOCKER_CONTEXT: "remoto" };
    expect(() => asegurarDestinoLocal("supabase_db_ucomenu", entorno, inspeccionar)).toThrow(/Docker local/);
  });

  it("con DOCKER_HOST remoto y un DOCKER_CONTEXT local, manda el contexto y se acepta", () => {
    const entorno = { DOCKER_HOST: "tcp://10.0.0.5:2375", DOCKER_CONTEXT: "local" };
    expect(() => asegurarDestinoLocal("supabase_db_ucomenu", entorno, inspeccionar)).not.toThrow();
  });

  it("un contexto que no se puede resolver o con nombre sospechoso se rechaza", () => {
    expect(() => asegurarDestinoLocal("supabase_db_ucomenu", { DOCKER_CONTEXT: "desconocido" }, inspeccionar)).toThrow(/Docker local/);
    const falla = () => {
      throw new Error("sin docker");
    };
    expect(() => asegurarDestinoLocal("supabase_db_ucomenu", {}, falla)).toThrow(/No se pudo determinar/);
  });

  it("rechaza un contenedor que no es de pruebas sin consultar a Docker", () => {
    vi.stubEnv("DOCKER_CONTEXT", "");
    vi.stubEnv("DOCKER_HOST", "npipe:////./pipe/dockerDesktopLinuxEngine");
    expect(() => asegurarDestinoLocal("base-de-clientes")).toThrow(/supabase_db_/);
  });

  it("acepta un DOCKER_HOST local con un contenedor de pruebas", () => {
    vi.stubEnv("DOCKER_CONTEXT", "");
    vi.stubEnv("DOCKER_HOST", "npipe:////./pipe/dockerDesktopLinuxEngine");
    expect(() => asegurarDestinoLocal("supabase_db_ucomenu-precios")).not.toThrow();
  });
});

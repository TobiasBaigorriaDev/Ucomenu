import { afterEach, describe, expect, it, vi } from "vitest";
import { asegurarDestinoLocal, esContenedorDePruebas, esDaemonDockerLocal } from "../rls/purge-price-history";

// Sin base ni Docker real: solo la decisión de si el destino de la limpieza es local.

describe("destino de la limpieza del historial de precios", () => {
  afterEach(() => vi.unstubAllEnvs());

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
    vi.stubEnv("DOCKER_HOST", "ssh://usuario@servidor-remoto");
    expect(() => asegurarDestinoLocal("supabase_db_ucomenu")).toThrow(/solo corre contra el Docker local/);
    vi.stubEnv("DOCKER_HOST", "tcp://10.1.2.3:2375");
    expect(() => asegurarDestinoLocal("supabase_db_ucomenu")).toThrow(/Docker local/);
  });

  it("rechaza un contenedor que no es de pruebas sin consultar a Docker", () => {
    vi.stubEnv("DOCKER_HOST", "npipe:////./pipe/dockerDesktopLinuxEngine");
    expect(() => asegurarDestinoLocal("base-de-clientes")).toThrow(/supabase_db_/);
  });

  it("acepta un DOCKER_HOST local con un contenedor de pruebas", () => {
    vi.stubEnv("DOCKER_HOST", "npipe:////./pipe/dockerDesktopLinuxEngine");
    expect(() => asegurarDestinoLocal("supabase_db_ucomenu-precios")).not.toThrow();
  });
});

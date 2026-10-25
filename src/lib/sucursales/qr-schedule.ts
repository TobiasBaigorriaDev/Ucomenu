/** Horarios diarios, sin zona: se interpretan con la zona horaria de la sucursal. */
export function parseQrResetTimes(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length > 24) return null;
  const times: string[] = [];
  for (const time of raw) {
    if (typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || times.includes(time)) return null;
    times.push(time);
  }
  return times.sort();
}

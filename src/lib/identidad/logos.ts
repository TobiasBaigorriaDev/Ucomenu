import { MAX_IMAGE_BYTES } from "@/lib/carta/images";

export const LOGO_BUCKET = "organization-logos";
export const MAX_LOGO_BYTES = MAX_IMAGE_BYTES;
const UUID_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export function isOwnLogoPath(path: string, orgId: string): boolean {
  return path.startsWith(`${orgId}/`) && UUID_FILE.test(path.slice(orgId.length + 1));
}

export function logoUrl(path: string | null | undefined): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return path && base ? `${base.replace(/\/$/, "")}/storage/v1/object/public/${LOGO_BUCKET}/${path}` : null;
}

import type { Metadata } from "next";
import { appInstalable } from "@/components/panel/app-instalable";
import { OrgEntry } from "@/components/panel/org-area";

export const metadata: Metadata = { title: "Sala", robots: { index: false, follow: false }, ...appInstalable };

export default function SalaEntryPage() {
  return <OrgEntry area="sala" />;
}

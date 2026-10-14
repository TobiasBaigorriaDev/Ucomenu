import type { Metadata } from "next";
import { OrgEntry } from "@/components/panel/org-area";

export const metadata: Metadata = { title: "Sala", robots: { index: false, follow: false } };

export default function SalaEntryPage() {
  return <OrgEntry area="sala" />;
}

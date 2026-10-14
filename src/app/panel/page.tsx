import type { Metadata } from "next";
import { OrgEntry } from "@/components/panel/org-area";

export const metadata: Metadata = { title: "Panel", robots: { index: false, follow: false } };

export default function PanelEntryPage() {
  return <OrgEntry area="panel" />;
}

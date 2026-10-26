import type { Metadata } from "next";
import { OrgEntry } from "@/components/panel/org-area";

export const metadata: Metadata = { title: "Cocina", robots: { index: false, follow: false } };

export default function CocinaEntryPage() {
  return <OrgEntry area="cocina" />;
}

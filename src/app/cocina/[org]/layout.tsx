import type { Metadata } from "next";
import { OrgArea } from "@/components/panel/org-area";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function CocinaOrgLayout({ children, params }: LayoutProps<"/cocina/[org]">) {
  const { org } = await params;
  return (
    <OrgArea area="cocina" slug={org}>
      {children}
    </OrgArea>
  );
}

import type { Metadata } from "next";
import { OrgArea } from "@/components/panel/org-area";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PanelOrgLayout({ children, params }: LayoutProps<"/panel/[org]">) {
  const { org } = await params;
  return (
    <OrgArea area="panel" slug={org}>
      {children}
    </OrgArea>
  );
}

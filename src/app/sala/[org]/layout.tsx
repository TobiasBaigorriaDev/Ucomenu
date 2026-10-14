import type { Metadata } from "next";
import { OrgArea } from "@/components/panel/org-area";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function SalaOrgLayout({ children, params }: LayoutProps<"/sala/[org]">) {
  const { org } = await params;
  return (
    <OrgArea area="sala" slug={org}>
      {children}
    </OrgArea>
  );
}

import type { Metadata } from "next";

import { EnterpriseInvitationAcceptance } from "@/components/enterprise/enterprise-invitation-acceptance";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "接受企业邀请 | Commerce Pilot",
  description: "接受 Commerce Pilot Enterprise 工作区邀请。",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function EnterpriseInvitationPage() {
  return <EnterpriseInvitationAcceptance />;
}

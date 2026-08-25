import type { Metadata } from "next";
import { TrunksView } from "@/components/telephony/trunks-view";

export const metadata: Metadata = {
  title: "SIP trunks",
};

export default async function SipTrunksPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <TrunksView projectId={projectId} />;
}

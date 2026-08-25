import type { Metadata } from "next";
import { DispatchView } from "@/components/telephony/dispatch-view";

export const metadata: Metadata = {
  title: "Dispatch rules",
};

export default async function DispatchRulesPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <DispatchView projectId={projectId} />;
}

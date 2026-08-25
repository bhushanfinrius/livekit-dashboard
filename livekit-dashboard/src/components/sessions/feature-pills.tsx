import { Badge } from "@/components/ui/badge";
import type { SessionFeature } from "@/lib/sessions/types";

const FEATURE_LABEL: Record<SessionFeature, string> = {
  agent: "Agent",
  sip: "SIP",
  egress: "Egress",
};

export function FeaturePills({ features }: { features: SessionFeature[] }) {
  if (features.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {features.map((feature) => (
        <Badge key={feature} variant="outline">
          {FEATURE_LABEL[feature]}
        </Badge>
      ))}
    </div>
  );
}

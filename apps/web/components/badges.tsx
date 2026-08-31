import { humanizeEnum } from "@recruitintel/shared";

import { Badge, type BadgeTone } from "@/components/ui/badge";

const eventTones: Record<string, BadgeTone> = {
  JOB_OPENED: "success",
  JOB_CHANGED: "warning",
  JOB_CLOSED: "neutral",
};

export function EventBadge({ value }: { value: string }) {
  return <Badge tone={eventTones[value] ?? "accent"}>{humanizeEnum(value)}</Badge>;
}

export function RoleBadge({ value }: { value: string }) {
  return <Badge tone="neutral">{humanizeEnum(value)}</Badge>;
}

export function DemoBadge() {
  return (
    <Badge className="border-dashed" tone="warning">
      Demo record
    </Badge>
  );
}

import type { ClientProductEvent } from "@recruitintel/types";

export function recordClientProductEvent(event: ClientProductEvent): void {
  void fetch("/api/instrumentation/events", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
    keepalive: true,
  });
}

import { redactError, redactValue } from "@recruitintel/shared";

type LogLevel = "info" | "warn" | "error";

function write(level: LogLevel, event: string, fields: Record<string, unknown> = {}) {
  const safeFields = redactValue(fields) as Record<string, unknown>;
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...safeFields,
  });
  if (level === "error") console.error(payload);
  else if (level === "warn") console.warn(payload);
  else console.info(payload);
}

export const logger = {
  info(event: string, fields?: Record<string, unknown>) {
    write("info", event, fields);
  },
  warn(event: string, fields?: Record<string, unknown>) {
    write("warn", event, fields);
  },
  error(event: string, error: unknown, fields: Record<string, unknown> = {}) {
    write("error", event, { ...fields, error: redactError(error) });
  },
};

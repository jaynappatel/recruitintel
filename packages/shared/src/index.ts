export function humanizeEnum(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatCompactDate(value: string | null): string {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: date.getUTCFullYear() === new Date().getUTCFullYear() ? undefined : "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function formatRelativeTime(value: string, now = new Date()): string {
  const timestamp = new Date(value).valueOf();
  if (Number.isNaN(timestamp)) return "Unknown";
  const minutes = Math.round((timestamp - now.valueOf()) / 60_000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}

export { REDACTED, REDACTED_EMAIL, redactError, redactText, redactValue } from "./redaction";

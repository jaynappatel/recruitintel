export const REDACTED = "[REDACTED]";
export const REDACTED_EMAIL = "[REDACTED_EMAIL]";

const SENSITIVE_KEY =
  /^(?:authorization|proxy-authorization|cookie|set-cookie|access_?token|refresh_?token|id_?token|session_?token|oauth_?code|client_?secret|password|secret|private_?key|encrypted_?refresh_?token|code_?verifier|resume_?text|dom|dom_?html|form_?values|raw_?payload)$/i;
const URL_KEY = /(?:url|uri|href)$/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const AUTHORIZATION_HEADER =
  /\b(?:authorization|proxy-authorization)\s*:\s*(?:(?:bearer|basic)\s+)?[^\s,;]+/gi;
const COOKIE_HEADER = /\b(?:cookie|set-cookie)\s*:\s*[^\r\n]+/gi;
const NAMED_SECRET =
  /\b(access_?token|refresh_?token|id_?token|session_?token|oauth_?code|client_?secret|code_?verifier|password)\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s&,;]+)/gi;
const HTTP_URL = /https?:\/\/[^\s<>"']+/gi;

function stripUrlQuery(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, parsed.pathname === "/" ? "/" : "");
  } catch {
    return value.split(/[?#]/, 1)[0] ?? value;
  }
}

export function redactText(value: string): string {
  return value
    .replace(AUTHORIZATION_HEADER, (match) => `${match.split(":", 1)[0]}: ${REDACTED}`)
    .replace(COOKIE_HEADER, (match) => `${match.split(":", 1)[0]}: ${REDACTED}`)
    .replace(NAMED_SECRET, (_match, name: string) => `${name}=${REDACTED}`)
    .replace(HTTP_URL, (url) => stripUrlQuery(url.replace(/[),.;]+$/, "")))
    .replace(EMAIL, REDACTED_EMAIL);
}

export function redactValue(value: unknown, key?: string, seen = new WeakSet<object>()): unknown {
  if (key && SENSITIVE_KEY.test(key)) return REDACTED;
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return key && URL_KEY.test(key) ? redactText(stripUrlQuery(value)) : redactText(value);
  }
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return redactError(value);
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, undefined, seen));
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redactValue(entryValue, entryKey, seen),
    ]),
  );
}

export function redactError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { name: "Error", message: redactText(String(error)) };
  }
  const output: Record<string, unknown> = {
    name: error.name,
    message: redactText(error.message),
  };
  if (error.stack) output.stack = redactText(error.stack);
  if ("cause" in error && error.cause !== undefined) output.cause = redactValue(error.cause);
  return output;
}

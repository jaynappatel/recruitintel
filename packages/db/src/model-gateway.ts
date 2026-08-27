import { createHash } from "node:crypto";

export const MODEL_PROMPT_VERSION = "m13-v1";
export const MODEL_SCHEMA_VERSION = "m13-v1";
export const MODEL_REDACTION_VERSION = "m13-v1";
export const MAX_MODEL_INPUT_BYTES = 24_000;
export const MAX_MODEL_OUTPUT_BYTES = 32_768;

export type ModelTask =
  | "REQUIREMENT_EXTRACT"
  | "EVIDENCE_EXTRACT"
  | "EXPLANATION_GENERATE"
  | "RESUME_SUGGEST";
export interface EvidenceReference {
  id: string;
  span: string;
}
export interface ModelRequest {
  task: ModelTask;
  sourceFingerprint: string;
  input: Record<string, unknown>;
  evidence: EvidenceReference[];
  provider?: string;
  model?: string;
  promptVersion?: string;
}
export type GatewayResult =
  | {
      status: "DETERMINISTIC" | "BLOCKED" | "ABSTAINED" | "REJECTED";
      reason: string;
      cacheKey: string;
    }
  | { status: "VALID"; output: Record<string, unknown>; cacheKey: string; cached: boolean };
export interface ModelProvider {
  name: string;
  paid: boolean;
  generate(request: ModelRequest): Promise<unknown>;
}

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const byteSize = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
const forbidden =
  /(?:api[_ -]?key|authorization|cookie|password|localstorage|sessionstorage|ignore (?:all |previous )?instructions|system prompt|environment variables)/i;

/** A small provider-neutral boundary. Untrusted source content is data, never instructions. */
export class BoundedModelGateway {
  private readonly cache = new Map<string, GatewayResult>();
  constructor(
    private readonly options: {
      zeroCostMode: boolean;
      provider?: ModelProvider;
      maxInputBytes?: number;
    } = { zeroCostMode: true },
  ) {}
  cacheKey(request: ModelRequest) {
    return digest({
      task: request.task,
      sourceFingerprint: request.sourceFingerprint,
      evidence: request.evidence,
      input: request.input,
      provider: request.provider ?? this.options.provider?.name ?? "local",
      model: request.model ?? "bounded",
      promptVersion: request.promptVersion ?? MODEL_PROMPT_VERSION,
      schema: MODEL_SCHEMA_VERSION,
      redaction: MODEL_REDACTION_VERSION,
    });
  }
  async execute(request: ModelRequest): Promise<GatewayResult> {
    const cacheKey = this.cacheKey(request);
    const cached = this.cache.get(cacheKey);
    if (cached) return cached.status === "VALID" ? { ...cached, cached: true } : cached;
    if (!request.evidence.length && request.task !== "EXPLANATION_GENERATE")
      return { status: "ABSTAINED", reason: "EVIDENCE_REQUIRED", cacheKey };
    if (byteSize(request.input) > (this.options.maxInputBytes ?? MAX_MODEL_INPUT_BYTES))
      return { status: "REJECTED", reason: "INPUT_LIMIT", cacheKey };
    // Injection phrases remain inert source data. Secret-bearing fields are never accepted.
    if (forbidden.test(JSON.stringify(Object.keys(request.input))))
      return { status: "REJECTED", reason: "UNSAFE_INPUT_FIELD", cacheKey };
    const provider = this.options.provider;
    if (!provider) return { status: "DETERMINISTIC", reason: "NO_MODEL_PROVIDER", cacheKey };
    if (this.options.zeroCostMode && provider.paid)
      return { status: "BLOCKED", reason: "ZERO_COST_MODE", cacheKey };
    let raw: unknown;
    try {
      raw = await provider.generate(request);
    } catch {
      return { status: "ABSTAINED", reason: "PROVIDER_UNAVAILABLE", cacheKey };
    }
    if (
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw) ||
      byteSize(raw) > MAX_MODEL_OUTPUT_BYTES
    )
      return { status: "REJECTED", reason: "SCHEMA_OR_OUTPUT_LIMIT", cacheKey };
    const output = raw as Record<string, unknown>;
    if (!this.validate(request, output))
      return { status: "REJECTED", reason: "UNGROUNDED_OUTPUT", cacheKey };
    const result: GatewayResult = { status: "VALID", output, cacheKey, cached: false };
    this.cache.set(cacheKey, result);
    return result;
  }
  private validate(request: ModelRequest, output: Record<string, unknown>) {
    if (request.task === "EXPLANATION_GENERATE")
      return (
        typeof output.explanation === "string" &&
        output.explanation.length <= 4000 &&
        Array.isArray(output.evidenceIds) &&
        output.evidenceIds.every((id) => request.evidence.some((reference) => reference.id === id))
      );
    const proposals = output.proposals;
    return (
      Array.isArray(proposals) &&
      proposals.length <= 30 &&
      proposals.every(
        (proposal) =>
          proposal &&
          typeof proposal === "object" &&
          typeof (proposal as Record<string, unknown>).evidenceId === "string" &&
          request.evidence.some(
            (reference) => reference.id === (proposal as Record<string, unknown>).evidenceId,
          ) &&
          typeof (proposal as Record<string, unknown>).span === "string" &&
          request.evidence.some(
            (reference) =>
              reference.id === (proposal as Record<string, unknown>).evidenceId &&
              reference.span.includes((proposal as Record<string, unknown>).span as string),
          ),
      )
    );
  }
}

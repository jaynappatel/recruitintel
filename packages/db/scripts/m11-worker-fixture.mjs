import { Buffer } from "node:buffer";
import { createCipheriv, createHash, randomBytes } from "node:crypto";

import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const sql = postgres(url, { max: 1 });
const user = "b1000000-0000-4000-8000-000000000001";
const document = "b1000000-0000-4000-8000-000000000002";
const version = "b1000000-0000-4000-8000-000000000003";
const bytes = Buffer.from("Python TypeScript resume", "utf8");
const hash = createHash("sha256").update(bytes).digest("hex");
const key = createHash("sha256").update("recruitintel-m11-local-resume-storage").digest();
const nonce = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", key, nonce);
cipher.setAAD(Buffer.from(`${user}:${hash}`, "utf8"));
const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
try {
  await sql.unsafe(
    "insert into public.users(id,name,email,email_verified,status) values ($1::uuid,$2,$3,true,$4) on conflict do nothing",
    [user, "M11 Worker User", "m11-worker@example.test", "ACTIVE"],
  );
  await sql.unsafe(
    "insert into public.resume_documents(id,user_id,storage_object_key,original_filename,media_type,byte_size,content_hash,status,storage_key,storage_ciphertext,storage_nonce,storage_key_version) values ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$3,$9,$10,1) on conflict do nothing",
    [
      document,
      user,
      "opaque-worker-key",
      "worker.txt",
      "text/plain",
      bytes.length,
      hash,
      "READY",
      ciphertext,
      nonce,
    ],
  );
  await sql.unsafe(
    "insert into public.resume_versions(id,document_id,user_id,version_number,text_hash) values ($1::uuid,$2::uuid,$3::uuid,1,$4) on conflict do nothing",
    [version, document, user, hash],
  );
  await sql.unsafe(
    "insert into public.work_items(work_type,work_class,user_id,resume_version_id,parser_version,idempotency_fingerprint,safe_diagnostics) values ($1::public.work_type,$2::public.work_class,$3::uuid,$4::uuid,1,$5,'{}'::jsonb) on conflict do nothing",
    ["RESUME_PARSE", "RESUME", user, version, "worker-smoke-parse-1"],
  );
} finally {
  await sql.end();
}

const MAX_CANDIDATES = 100;
const INVISIBLE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;

export function cleanText(value, maximum) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

export function cleanUrl(value, base = globalThis.location?.href) {
  try {
    const url = new URL(value, base);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    if (url.hostname === "linkedin.com" || url.hostname.endsWith(".linkedin.com")) return null;
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function visible(element) {
  if (!(element instanceof Element)) return false;
  if (
    element.closest(
      "script,style,noscript,template,form,input,textarea,select,button,[aria-hidden='true'],[hidden]",
    )
  )
    return false;
  const style = globalThis.getComputedStyle?.(element);
  return (
    !style ||
    (style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0)
  );
}

function candidateFromJsonLd(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const types = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
  if (!types.includes("JobPosting")) return null;
  const url = cleanUrl(item.url || item.sameAs || location.href);
  const title = cleanText(item.title, 300);
  if (!url || !title) return null;
  const location = cleanText(
    item.jobLocation?.address?.addressLocality ||
      item.jobLocation?.address?.addressRegion ||
      item.jobLocation?.name ||
      "",
    300,
  );
  return {
    kind: "JSON_LD",
    url,
    title,
    companyName: cleanText(item.hiringOrganization?.name || "", 300) || null,
    location,
    descriptionExcerpt: cleanText(item.description || "", 8000),
    extractionMetadata: { source: "json_ld" },
  };
}

function jsonLdCandidates(document) {
  const candidates = [];
  for (const script of document.querySelectorAll("script[type='application/ld+json']")) {
    const raw = script.textContent || "";
    if (raw.length > 50_000) continue;
    try {
      const parsed = JSON.parse(raw);
      const values = Array.isArray(parsed) ? parsed : parsed?.["@graph"] || [parsed];
      for (const value of values) {
        const candidate = candidateFromJsonLd(value);
        if (candidate) candidates.push(candidate);
      }
    } catch {
      // JSON-LD is untrusted and malformed data is simply ignored.
    }
  }
  return candidates;
}

function gridCandidates(document) {
  const candidates = [];
  for (const anchor of document.querySelectorAll("a[href]")) {
    if (!visible(anchor)) continue;
    const url = cleanUrl(anchor.getAttribute("href"));
    const title = cleanText(anchor.textContent, 300);
    if (!url || !title || title.length < 3) continue;
    const card =
      anchor.closest(
        "article,li,[role='listitem'],[data-job-id],[class*='job'],[class*='position']",
      ) || anchor.parentElement;
    if (!card || !visible(card)) continue;
    const cardText = cleanText(card.textContent, 8000);
    if (
      !/\b(job|career|position|engineer|intern|developer|analyst|designer|manager)\b/i.test(
        `${title} ${cardText}`,
      )
    )
      continue;
    candidates.push({
      kind: "GRID",
      url,
      title,
      companyName: null,
      location: cleanText(
        card.querySelector("[class*='location'],[data-location]")?.textContent || "",
        300,
      ),
      descriptionExcerpt: cardText,
      extractionMetadata: { source: "rendered_grid" },
    });
  }
  return candidates;
}

function singleCandidate(document) {
  const title = cleanText(document.querySelector("h1")?.textContent || document.title, 300);
  const url = cleanUrl(location.href);
  if (!title || !url) return null;
  const description = cleanText(
    document.querySelector("main,article,[role='main']")?.textContent || "",
    8000,
  );
  if (
    !/\b(job|career|position|engineer|intern|developer|analyst|designer|manager)\b/i.test(
      `${title} ${description}`,
    )
  )
    return null;
  return {
    kind: "SINGLE",
    url,
    title,
    companyName: null,
    location: "",
    descriptionExcerpt: description,
    extractionMetadata: { source: "single_job" },
  };
}

export function deduplicateCandidates(candidates) {
  const byUrl = new Map();
  const priority = { JSON_LD: 3, SINGLE: 2, GRID: 1 };
  for (const candidate of candidates) {
    const prior = byUrl.get(candidate.url);
    if (!prior || priority[candidate.kind] > priority[prior.kind])
      byUrl.set(candidate.url, candidate);
  }
  return [...byUrl.values()].slice(0, MAX_CANDIDATES);
}

export function extractCurrentPage(document = globalThis.document) {
  const jsonLd = jsonLdCandidates(document);
  const grid = gridCandidates(document);
  const candidates = deduplicateCandidates([
    ...jsonLd,
    ...grid,
    ...(grid.length || jsonLd.length ? [] : [singleCandidate(document)].filter(Boolean)),
  ]);
  return {
    protocolVersion: 1,
    pageUrl: cleanUrl(location.href),
    pageTitle: cleanText(document.title, 300),
    jsonLdCount: jsonLd.length,
    linkCount: Math.min(document.querySelectorAll("a[href]").length, 250),
    candidates,
  };
}

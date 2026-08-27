const $ = (id) => document.getElementById(id);
const status = $("status");
const scanButton = $("scan");
const candidates = $("candidates");
let config = {};

function apiUrl(path) {
  return new URL(
    path,
    config.server.endsWith("/") ? config.server : `${config.server}/`,
  ).toString();
}
async function request(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || "RecruitIntel request failed");
  return body.data;
}
function setStatus(message) {
  status.textContent = message;
}
function render(scan) {
  candidates.replaceChildren();
  for (const candidate of scan.candidates) {
    const article = document.createElement("article");
    const title = document.createElement("strong");
    title.textContent = candidate.title;
    const summary = document.createElement("p");
    summary.className = "muted";
    summary.textContent = `${candidate.location || "Location unknown"} · confidence ${candidate.rankScore}`;
    const select = document.createElement("button");
    select.textContent = "Save selected job";
    const actions = document.createElement("span");
    actions.hidden = true;
    const application = document.createElement("button");
    application.textContent = "Add to application board";
    const plan = document.createElement("button");
    plan.textContent = "Create application plan";
    actions.append(application, plan);
    select.onclick = async () => {
      select.disabled = true;
      try {
        const decision = await request(`/api/extension/candidates/${candidate.id}/select`, {
          method: "POST",
          body: JSON.stringify({
            candidateRevision: candidate.revision,
            idempotencyKey: crypto.randomUUID(),
          }),
        });
        setStatus(
          decision.status === "RESOLVED"
            ? "Saved to RecruitIntel."
            : "Saved privately; policy prevents shared ingestion.",
        );
        if (decision.status === "RESOLVED") {
          actions.hidden = false;
          application.onclick = async () => {
            application.disabled = true;
            try {
              await request(`/api/extension/decisions/${decision.id}/application`, {
                method: "POST",
                body: JSON.stringify({ cycleKey: `extension-${crypto.randomUUID()}` }),
              });
              setStatus("Added to your application board.");
            } catch (error) {
              setStatus(error.message);
              application.disabled = false;
            }
          };
          plan.onclick = async () => {
            plan.disabled = true;
            try {
              const target = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
              await request(`/api/extension/decisions/${decision.id}/plan`, {
                method: "POST",
                body: JSON.stringify({
                  title: `Apply: ${candidate.title}`,
                  targetDate: target,
                  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
                }),
              });
              setStatus("Created your application plan.");
            } catch (error) {
              setStatus(error.message);
              plan.disabled = false;
            }
          };
        }
      } catch (error) {
        setStatus(error.message);
        select.disabled = false;
      }
    };
    const provenance = document.createElement("p");
    provenance.className = "muted";
    provenance.textContent = `${candidate.kind.replace("_", " ")} · ${candidate.url}`;
    article.append(title, summary, provenance, select, actions);
    candidates.append(article);
  }
}
async function load() {
  config = await chrome.storage.local.get(["server", "token"]);
  $("server").value = config.server || "";
  $("token").value = config.token || "";
  scanButton.disabled = !(config.server && config.token);
}
$("connect").onclick = async () => {
  const server = $("server").value.trim().replace(/\/$/, "");
  const token = $("token").value.trim();
  try {
    if (!/^https?:\/\//.test(server) || !token)
      throw new Error("Enter an http(s) server and scoped grant.");
    const origin = new URL(server).origin;
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) throw new Error("Server permission was not granted.");
    config = { server, token };
    await request("/api/extension/connect");
    await chrome.storage.local.set(config);
    scanButton.disabled = false;
    setStatus("Connected.");
  } catch (error) {
    setStatus(error.message);
  }
};
scanButton.onclick = async () => {
  scanButton.disabled = true;
  candidates.replaceChildren();
  try {
    setStatus("Reading the current rendered page…");
    const result = await chrome.runtime.sendMessage({ type: "RECRUITINTEL_SCAN_ACTIVE_TAB" });
    if (!result?.ok || !result.scan?.pageUrl)
      throw new Error(result?.error || "No supported jobs found.");
    const scan = await request("/api/extension/scans", {
      method: "POST",
      body: JSON.stringify(result.scan),
    });
    render(scan);
    setStatus(`Found ${scan.candidates.length} candidate jobs. Select only the ones to save.`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    scanButton.disabled = false;
  }
};
load();

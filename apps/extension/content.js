import { extractCurrentPage } from "./extract.js";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "RECRUITINTEL_EXPLICIT_SCAN") return undefined;
  try {
    sendResponse({ ok: true, scan: extractCurrentPage() });
  } catch {
    sendResponse({ ok: false, error: "The current page could not be scanned safely." });
  }
  return true;
});

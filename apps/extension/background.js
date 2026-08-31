async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url))
    throw new Error("Open an http(s) careers or job page first.");
  return tab;
}

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "RECRUITINTEL_SCAN_ACTIVE_TAB") return undefined;
  (async () => {
    const tab = await activeTab();
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    const result = await chrome.tabs.sendMessage(tab.id, { type: "RECRUITINTEL_EXPLICIT_SCAN" });
    sendResponse(result);
  })().catch((error) =>
    sendResponse({ ok: false, error: error instanceof Error ? error.message : "Scan failed" }),
  );
  return true;
});

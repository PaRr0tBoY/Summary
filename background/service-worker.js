// Background Service Worker

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    enabled: true,
    smartTrigger: true,
    baseUrl: "",
    model: "",
    apiKey: "",
    blockedSites: [],
    customPrompt: "",
  });
});

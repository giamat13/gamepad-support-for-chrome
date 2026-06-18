let lastSwitchTime = 0;
let lastCloseTime = 0;
const SWITCH_COOLDOWN_MS = 400;
const CLOSE_COOLDOWN_MS = 600;
const FALLBACK_URL = 'https://www.google.com';

// Redirect any new tab page to google.com
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url === 'chrome://newtab/') {
    chrome.tabs.update(tabId, { url: FALLBACK_URL });
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'closeTab') {
    const now = Date.now();
    if (now - lastCloseTime >= CLOSE_COOLDOWN_MS) {
      lastCloseTime = now;
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) chrome.tabs.remove(tabs[0].id);
      });
    }
    sendResponse({});
    return true;
  }

  if (msg.type !== 'switchTab') return;

  const now = Date.now();
  if (now - lastSwitchTime < SWITCH_COOLDOWN_MS) {
    sendResponse({});
    return true;
  }
  lastSwitchTime = now;

  chrome.tabs.query({ currentWindow: true }, (tabs) => {
    const sorted = tabs
      .filter((t) => !t.url?.startsWith('chrome://'))
      .sort((a, b) => a.index - b.index);
    const activeIdx = sorted.findIndex((t) => t.active);

    if (msg.direction === 'next') {
      if (activeIdx < sorted.length - 1) {
        chrome.tabs.update(sorted[activeIdx + 1].id, { active: true });
      } else {
        chrome.tabs.create({ url: FALLBACK_URL });
      }
    } else {
      if (activeIdx > 0) {
        chrome.tabs.update(sorted[activeIdx - 1].id, { active: true });
      } else {
        chrome.tabs.create({ url: FALLBACK_URL, index: 0 });
      }
    }
  });

  sendResponse({});
  return true;
});

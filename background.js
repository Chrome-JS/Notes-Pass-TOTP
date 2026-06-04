// background.js
import { getHostFromUrl, matchUrlPatterns } from './utils.js';
import { syncWithGoogleDrive } from './driveSync.js';

let indexCache = {};

async function initCache() {
  const data = await chrome.storage.local.get('__index');
  indexCache = data.__index || {};
}
initCache();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes['__index']) {
    indexCache = changes['__index'].newValue || {};
  }
});

function checkTabStatus(tabId, url) {
  if (!url) return;
  const host = getHostFromUrl(url);
  if (!host) return;

  const entriesRaw = indexCache[host];
  if (!entriesRaw) {
    chrome.action.setBadgeText({ tabId, text: '' });
    return;
  }

  // Нормализация
  let entries = [];
  if (typeof entriesRaw === 'string') entries = [{ i: entriesRaw, p: '' }];
  else if (Array.isArray(entriesRaw)) entries = entriesRaw;

  let foundMatch = false;

  for (const entry of entries) {
    if (!entry) continue;
    let guid, patterns;
    
    if (typeof entry === 'string') { guid = entry; patterns = ''; }
    else { guid = entry.i; patterns = entry.p || ''; }

    // Вызов нашей строгой функции
    if (matchUrlPatterns(url, patterns)) {
      foundMatch = true;
      break;
    }
  }

  if (foundMatch) {
    chrome.action.setBadgeText({ tabId, text: 'OK' });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#4CAF50' });
  } else {
    chrome.action.setBadgeText({ tabId, text: '' });
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) checkTabStatus(tabId, tab.url);
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  if (tab.url) checkTabStatus(activeInfo.tabId, tab.url);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "refresh_icon" && message.tabId && message.url) {
    checkTabStatus(message.tabId, message.url);
  }
  if (message.action === "start_background_sync") {
    syncWithGoogleDrive(false).catch(err => console.error(err));
  }
});



chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "open-about-page",
    title: "About",
    // Тип 'action' означает, что пункт появится именно при клике на иконку расширения
    contexts: ["action"] 
  });
});


chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "open-about-page") {
    // Открываем локальный файл about.html в новой вкладке
    chrome.tabs.create({
      url: chrome.runtime.getURL("about.html")
    });
  }
});
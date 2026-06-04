// db.js

import { parseHostsText } from './utils.js';


export async function getRecord(guid) {
  if (!guid) return null;
  const data = await chrome.storage.local.get(guid);
  return data[guid] || null;
}




export async function saveRecord(guid, recordData, hostsText) {
  // 1. Сохраняем саму запись
  await chrome.storage.local.set({ [guid]: recordData });

  // 2. Обновляем индекс
  const storageData = await chrome.storage.local.get('__index');
  const index = storageData.__index || {};
  const freshHosts = parseHostsText(hostsText);

  // Чистим старое
  for (const host in index) {
    if (Array.isArray(index[host])) {
      index[host] = index[host].filter(item => {
        const id = (typeof item === 'string') ? item : item.i;
        return id !== guid;
      });
      if (index[host].length === 0) delete index[host];
    } else if (typeof index[host] === 'string' && index[host] === guid) {
      delete index[host];
    }
  }

  // Пишем новое
  // БЕРЕМ ПАТТЕРН ИЗ ЗАПИСИ
  const patterns = recordData.urlPatterns || ''; 

  freshHosts.forEach(host => {
    if (!index[host]) index[host] = [];
    // Кладем объект { i: ID, p: Patterns }
    index[host].push({ i: guid, p: patterns });
  });

  await chrome.storage.local.set({ '__index': index });
}




export async function deleteRecord(guid) {
  if (!guid) return;
  await chrome.storage.local.remove(guid);

  const storageData = await chrome.storage.local.get(['__index', '__deleted']);
  const index = storageData.__index || {};
  const deletedList = storageData.__deleted || [];

  for (const host in index) {
    if (Array.isArray(index[host])) {
      index[host] = index[host].filter(item => {
        const id = (typeof item === 'string') ? item : item.i;
        return id !== guid;
      });
      if (index[host].length === 0) delete index[host];
    } else if (typeof index[host] === 'string' && index[host] === guid) {
      delete index[host];
    }
  }

  if (!deletedList.includes(guid)) deletedList.push(guid);
  await chrome.storage.local.set({ '__index': index, '__deleted': deletedList });
}




// Функция для полной пересборки индекса (вызывается из driveSync)
export async function rebuildIndexFromRecords(recordsMap) {
  const freshIndex = {};

  for (const guid in recordsMap) {
    const record = recordsMap[guid];
    // Пропускаем служебные ключи
    if (guid === '__index' || guid === '__deleted') continue;

    if (record && record.hosts) {
      const hostsArray = parseHostsText(record.hosts);
      const patterns = record.urlPatterns || '';

      hostsArray.forEach(host => {
        if (!freshIndex[host]) freshIndex[host] = [];
        // Используем тот же формат, что и при сохранении
        freshIndex[host].push({ i: guid, p: patterns });
      });
    }
  }

  await chrome.storage.local.set({ '__index': freshIndex });
}




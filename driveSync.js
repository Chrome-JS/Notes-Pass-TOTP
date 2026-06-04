import { parseHostsText } from './utils.js';
import { rebuildIndexFromRecords } from './db.js';


// Функция принудительного сброса кривого токена
async function forceResetToken() {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (token) {
        console.log("Найден старый токен, удаляем его...");
        chrome.identity.removeCachedAuthToken({ token }, () => {
          console.log("Старый токен удален из кэша.");
          resolve();
        });
      } else {
        resolve();
      }
    });
  });
}

// =========================================================================
// ШАГ 0: Получение токена
// =========================================================================
async function getAuthToken(interactive = true) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      resolve(token);
    });
  });
}

// =========================================================================
// ШАГ 1: Поиск или создание папки "ChromeExt.NotesTOTPS"
// =========================================================================
async function getOrCreateFolder(token) {
  const folderName = 'ChromeExt.NotesTOTPS';
  
  // 1. Ищем папку
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false&spaces=drive&fields=files(id,name)`;
  
  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });

  // ПРОВЕРКА ОШИБКИ
  if (!searchRes.ok) {
    const errData = await searchRes.json();
    console.error("Ошибка поиска папки:", errData);
    throw new Error(`Google API Error: ${errData.error.message}`);
  }

  const searchData = await searchRes.json();

  if (searchData.files && searchData.files.length > 0) {
    console.log(`Папка "${folderName}" найдена, ID:`, searchData.files[0].id);
    return searchData.files[0].id;
  }

  // 2. Создаем папку
  console.log(`Папка "${folderName}" не найдена, создаем новую...`);
  const metadata = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder'
  };
  
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(metadata)
  });
  
  // ПРОВЕРКА ОШИБКИ
  if (!createRes.ok) {
    const errData = await createRes.json();
    console.error("Ошибка создания папки:", errData);
    throw new Error(`Google API Error: ${errData.error.message}`);
  }

  const folderData = await createRes.json();
  console.log(`Папка создана, ID:`, folderData.id);
  return folderData.id;
}
// =========================================================================
// Вспомогательные функции работы с файлами
// =========================================================================

// Получение списка файлов КОНКРЕТНО В НАШЕЙ ПАПКЕ
async function fetchAllFilesFromDrive(token, folderId) {
  // Фильтр: родители содержат folderId
  const url = `https://www.googleapis.com/drive/v3/files?q='${folderId}' in parents and trashed=false&spaces=drive&fields=files(id,name)`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await response.json();
  return data.files || [];
}

async function deleteFileFromDrive(googleFileId, token) {
  const url = `https://www.googleapis.com/drive/v3/files/${googleFileId}`;
  await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function createNewFileInDrive(filename, jsonData, token, folderId) {
  const metadata = {
    name: filename,
    mimeType: 'application/json',
    parents: [folderId] // Привязываем к нашей папке
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([JSON.stringify(jsonData)], { type: 'application/json' }));

  await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
}

async function updateExistingFileInDrive(googleFileId, jsonData, token) {
  await fetch(`https://www.googleapis.com/upload/drive/v3/files/${googleFileId}?uploadType=media`, {
    method: 'PATCH',
    headers: { 
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(jsonData)
  });
}

async function downloadFileContentFromDrive(googleFileId, token) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${googleFileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return await response.json();
}

// =========================================================================
// ГЛАВНЫЙ ЭКСПОРТИРУЕМЫЙ МЕТОД
// =========================================================================
async function syncWithGoogleDrive_000(interactive = true) {
  try {

    // await forceResetToken(); 


    // 1. Авторизация
    const token = await getAuthToken(interactive);

    // 2. ГАРАНТИЯ НАЛИЧИЯ ПАПКИ (Первый приоритет)
    const folderId = await getOrCreateFolder(token);

    // 3. Получаем список файлов из этой папки
    const driveFilesList = await fetchAllFilesFromDrive(token, folderId); 
    const driveMap = {};
    driveFilesList.forEach(f => { driveMap[f.name] = f.id; });

    // ---------------------------------------------------------------------
    // ДАЛЬШЕ ТВОЯ ЛОГИКА СИНХРОНИЗАЦИИ (БЕЗ ИЗМЕНЕНИЙ)
    // ---------------------------------------------------------------------
    
    // Обработка удалений
    const storageData = await chrome.storage.local.get('__deleted');
    const deletedList = storageData.__deleted || [];

    if (deletedList.length > 0) {
      for (const guid of deletedList) {
        const filename = `${guid}.json`;
        if (driveMap[filename]) {
          await deleteFileFromDrive(driveMap[filename], token);
          delete driveMap[filename]; 
        }
      }
      await chrome.storage.local.remove('__deleted');
    }

    // Сверка файлов
    const allLocalData = await chrome.storage.local.get(null);
    const localGuids = Object.keys(allLocalData).filter(key => !key.startsWith('__'));

    for (const guid of localGuids) {
      const localRecord = allLocalData[guid];
      const filename = `${guid}.json`;

      if (driveMap[filename]) {
        const cloudContent = await downloadFileContentFromDrive(driveMap[filename], token);
        
        const localTime = localRecord.updatedAt || 0;
        const cloudTime = cloudContent.updatedAt || 0;

        if (localTime > cloudTime) {
          await updateExistingFileInDrive(driveMap[filename], localRecord, token);
        } else if (cloudTime > localTime) {
          await chrome.storage.local.set({ [guid]: cloudContent });
        }
        delete driveMap[filename];
      } else {
        // Передаем folderId при создании
        await createNewFileInDrive(filename, localRecord, token, folderId);
      }
    }

    // Скачивание новых с облака
    for (const filename in driveMap) {
      const googleFileId = driveMap[filename];
      const cloudContent = await downloadFileContentFromDrive(googleFileId, token);
      
      const guid = filename.replace('.json', '');
      await chrome.storage.local.set({ [guid]: cloudContent });
    }

    // ---------------------------------------------------------------------
    // ШАГ 5: Финальная пересборка локального __index хостов
    // ---------------------------------------------------------------------
    // Так как мы могли скачать новые файлы или обновить старые, индекс хостов нужно пересобрать с нуля
    const updatedLocalData = await chrome.storage.local.get(null);
    const freshIndex = {};
    
    // Импортируем утилиту парсинга, чтобы разбить textarea на массив строк
    // const { parseHostsText } = await import('./utils.js'); // Если нужно

    for (const key in updatedLocalData) {
      if (key !== '__index' && key !== '__deleted') {
        const record = updatedLocalData[key];
        if (record && record.hosts) {
          const hostsArray = parseHostsText(record.hosts);
          
          // ВАЖНО: Берем паттерны из записи, чтобы сохранить их в индекс
          const patterns = record.urlPatterns || '';

          hostsArray.forEach(host => {
            // Инициализируем массив, если пусто
            if (!freshIndex[host]) freshIndex[host] = [];

            // Записываем объект { i: ID, p: Patterns }
            freshIndex[host].push({ i: key, p: patterns });
          });
        }
      }
    }
    
    // Записываем начисто актуальный индекс в хранилище
    await chrome.storage.local.set({ '__index': freshIndex });
    
    console.log("Синхронизация завершена успешно!");
    return true;
    
  } catch (error) {
    console.error("Критическая ошибка синхронизации:", error);
    throw error;
  }
}




export async function syncWithGoogleDrive(interactive = true) {
  try {
    // 1. Авторизация
    const token = await getAuthToken(interactive);

    // 2. Папка
    const folderId = await getOrCreateFolder(token);

    // 3. Список файлов из облака
    const driveFilesList = await fetchAllFilesFromDrive(token, folderId); 
    const driveMap = {};
    driveFilesList.forEach(f => { driveMap[f.name] = f.id; });

    // ---------------------------------------------------------------------
    // ЛОГИКА СИНХРОНИЗАЦИИ
    // ---------------------------------------------------------------------
    
    // Обработка удалений
    const storageData = await chrome.storage.local.get('__deleted');
    const deletedList = storageData.__deleted || [];

    if (deletedList.length > 0) {
      for (const guid of deletedList) {
        const filename = `${guid}.json`;
        if (driveMap[filename]) {
          await deleteFileFromDrive(driveMap[filename], token);
          delete driveMap[filename]; 
        }
      }
      await chrome.storage.local.remove('__deleted');
    }

    // Сверка файлов
    const allLocalData = await chrome.storage.local.get(null);
    const localGuids = Object.keys(allLocalData).filter(key => !key.startsWith('__'));

    for (const guid of localGuids) {
      const localRecord = allLocalData[guid];
      const filename = `${guid}.json`;

      if (driveMap[filename]) {
        const cloudContent = await downloadFileContentFromDrive(driveMap[filename], token);
        
        const localTime = localRecord.updatedAt || 0;
        const cloudTime = cloudContent.updatedAt || 0;

        if (localTime > cloudTime) {
          await updateExistingFileInDrive(driveMap[filename], localRecord, token);
        } else if (cloudTime > localTime) {
          await chrome.storage.local.set({ [guid]: cloudContent });
        }
        delete driveMap[filename];
      } else {
        await createNewFileInDrive(filename, localRecord, token, folderId);
      }
    }

    // Скачивание новых с облака
    for (const filename in driveMap) {
      const googleFileId = driveMap[filename];
      const cloudContent = await downloadFileContentFromDrive(googleFileId, token);
      
      const guid = filename.replace('.json', '');
      await chrome.storage.local.set({ [guid]: cloudContent });
    }

    // ---------------------------------------------------------------------
    // ФИНАЛ: Пересборка индекса (делегируем db.js)
    // ---------------------------------------------------------------------
    const updatedLocalData = await chrome.storage.local.get(null);
    await rebuildIndexFromRecords(updatedLocalData);
    
    console.log("Синхронизация завершена успешно!");
    return true;
    
  } catch (error) {
    console.error("Критическая ошибка синхронизации:", error);
    throw error;
  }
}
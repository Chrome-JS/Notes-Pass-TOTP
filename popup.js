import { getHostFromUrl, findGuidForHost, matchUrlPatterns } from './utils.js';
import { getRecord, saveRecord, deleteRecord } from './db.js';
import { initTotp, stopTotp } from './totp.js';
import { syncWithGoogleDrive } from './driveSync.js';

let currentGuid = null;
let currentHost = null;
let currentTab = null;
let matchedRecords = [];

const btnApply = document.getElementById('btn-apply');
const btnDelete = document.getElementById('btn-delete');
const statusBadge = document.getElementById('record-status');


const el = (id) => document.getElementById(id);

const passwordField = el('password');
const totpsecretField = el('secret');

const formFields = ['login', 'password', 'secret', 'note', 'hosts', 'urlPatterns'];



function loadRecordToUI(record) {

  currentGuid = record.id;
  
  statusBadge.textContent = chrome.i18n.getMessage("sts_savedNote");
  statusBadge.className = "status-badge status-exists";
  btnDelete.classList.remove('hidden');

  el('login').value = record.login || '';
  el('password').value = record.password || '';
  el('secret').value = record.secret || '';
  el('note').value = record.note || '';
  el('hosts').value = record.hosts || '';
  
  if(el('urlPatterns')) el('urlPatterns').value = record.urlPatterns || '';

  if (record.secret) initTotp(record.secret);
  else stopTotp();
}


function resetUI() {

  currentGuid = null;

  statusBadge.textContent = chrome.i18n.getMessage("sts_newNote");
  statusBadge.className = "status-badge status-new";
  btnDelete.classList.add('hidden');
  
  // Чистим поля
  formFields.forEach(id => { if(el(id)) el(id).value = ''; });
  // Восстанавливаем текущий хост
  if(currentHost) el('hosts').value = currentHost;
  
  stopTotp();
}

document.addEventListener('DOMContentLoaded', async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || tabs.length === 0) return;
  
  currentTab = tabs[0];
  currentHost = getHostFromUrl(currentTab.url);
  if (!currentHost) return;

  el('hosts').value = currentHost;

  // --- НОВАЯ ЛОГИКА ПОИСКА И СЕЛЕКТОРА ---
  
  const selector = document.getElementById('record-selector');
  const storageData = await chrome.storage.local.get('__index');
  const guids = findGuidForHost(currentHost, storageData.__index || {});
  
  matchedRecords = []; // Сброс массива

  // 1. Собираем все подходящие записи
  for (const guid of guids) {
    const rec = await getRecord(guid);
    if (rec && matchUrlPatterns(currentTab.url, rec.urlPatterns || '')) {
      matchedRecords.push(rec);
    }
  }

  // 2. Обработка кейсов
  if (matchedRecords.length === 0) {
    // Записей нет
    selector.classList.add('hidden');
    resetUI();
    el('note').value = await getSelectedText() || '';
    
  } else if (matchedRecords.length === 1) {
    // Одна запись
    selector.classList.add('hidden');
    loadRecordToUI(matchedRecords[0]);
    
  } else {
    // Много записей -> Показываем Селектор
    selector.classList.remove('hidden');
    selector.innerHTML = ''; // Очистка

    matchedRecords.forEach(rec => {
      const option = document.createElement('option');
      
      // Формируем текст: Login или Note
      let text = rec.login;
      if (!text && rec.note) {
        text = rec.note.substring(0, 20) + (rec.note.length > 20 ? '...' : '');
      }
      if (!text) text = 'No Title';
      
      option.textContent = text;
      option.value = rec.id;         // Value = GUID
      option.title = rec.id;         // Hint (Tooltip) = GUID
      
      selector.appendChild(option);
    });

    // Загружаем первую запись
    loadRecordToUI(matchedRecords[0]);
  }

  // Слушатель переключения селектора
  selector.addEventListener('change', (e) => {
    const selectedGuid = e.target.value;
    const record = matchedRecords.find(r => r.id === selectedGuid);
    if (record) {
      loadRecordToUI(record);
    }
  });

  // --- КОНЕЦ ЛОГИКИ СЕЛЕКТОРА ---

  // Активация кнопки Apply при вводе
  formFields.forEach(fieldId => {
    const element = el(fieldId);
    if (element) {
      element.addEventListener('input', () => btnApply.disabled = false);
    }
  });
});


btnApply.addEventListener('click', async () => {

  const login = el('login') ? el('login').value.trim() : '';
  const password = el('password') ? el('password').value : '';
  const secret = el('secret') ? el('secret').value.trim() : '';
  const note = el('note') ? el('note').value : '';
  const hostsText = el('hosts') ? el('hosts').value : '';
  const urlPatterns = el('urlPatterns') ? el('urlPatterns').value : '';

  if (!currentGuid) {
    currentGuid = self.crypto.randomUUID();
  }

  const updatedRecord = {
    id: currentGuid,
    login,
    password,
    secret,
    note,
    hosts: hostsText,
    urlPatterns,
    updatedAt: Date.now()
  };

  await saveRecord(currentGuid, updatedRecord, hostsText);

  if (secret) initTotp(secret);
  else stopTotp();

  statusBadge.textContent = chrome.i18n.getMessage("sts_savedNote");
  statusBadge.className = "status-badge status-exists";

  btnDelete.classList.remove('hidden');

  btnApply.disabled = true;
  btnApply.textContent = "Saved!";

  btnApply.classList.add('btn-success');
  setTimeout(() => {
    btnApply.textContent = chrome.i18n.getMessage("btn_Apply");
    btnApply.classList.remove('btn-success');
  }, 1500);

  if (currentTab && currentTab.id && currentTab.url) {
    chrome.runtime.sendMessage({ 
      action: "refresh_icon", 
      tabId: currentTab.id, 
      url: currentTab.url 
    });
  }

  // 5. Запуск синхронизации (Проверка токена -> Фон)
  // interactive: true покажет окно логина, если мы не залогинены
  chrome.identity.getAuthToken({ interactive: true }, (token) => {
    if (token) {
      // Токен есть (или только что получили), шлем команду фону делать sync
      chrome.runtime.sendMessage({ action: "start_background_sync" });
    } else {
      // Если токена нет (юзер отменил логин), просто сохранено локально
      console.log("Синхронизация пропущена (нет токена).");
    }
  });


  // --- ОБНОВЛЕНИЕ СПИСКА (COMBOBOX) ---
  
  const selector = document.getElementById('record-selector');
  
  // 1. Обновляем массив в памяти (чтобы знал о новой записи или изменениях)
  const idx = matchedRecords.findIndex(r => r.id === currentGuid);
  if (idx === -1) {
    matchedRecords.push(updatedRecord); // Если новой записи не было - добавляем
  } else {
    matchedRecords[idx] = updatedRecord; // Если была - обновляем
  }

  // 2. Обновляем визуальный список
  let option = selector.querySelector(`option[value="${currentGuid}"]`);
  
  // Текст для списка: Логин или кусок Note
  const text = login || (note ? note.substring(0, 15) + '...' : 'No Title');

  if (!option) {
    // Если опции нет (создали новую запись) - создаем элемент
    option = document.createElement('option');
    option.value = currentGuid;
    selector.appendChild(option);
  }
  
  // Обновляем текст
  option.textContent = text;

  // 3. Логика отображения
  if (matchedRecords.length > 1) {
    selector.classList.remove('hidden'); // Показываем если > 1
    selector.value = currentGuid; // Выбираем текущую
  } else {
    selector.classList.add('hidden'); // Прячем если одна
  }

});


btnDelete.addEventListener('click', async () => {

  if (!currentGuid) return;

  await deleteRecord(currentGuid);

  // 1. Удаляем из массива памяти
  matchedRecords = matchedRecords.filter(r => r.id !== currentGuid);

  // 2. Удаляем из HTML списка
  const selector = document.getElementById('record-selector');
  const opt = selector.querySelector(`option[value="${currentGuid}"]`);
  if (opt) opt.remove();

  statusBadge.textContent = chrome.i18n.getMessage("sts_deletedNote");


  // 3. Логика отображения
  if (matchedRecords.length > 0) {
    // Берем следующую запись
    const nextRec = matchedRecords[0];
    loadRecordToUI(currentGuid);
    selector.value = currentGuid;
    if (matchedRecords.length === 1) selector.classList.add('hidden');
  } else {
    resetUI(); // Эта функция тоже все сделает сама
    selector.classList.add('hidden');
    el('hosts').value = currentHost;
  }

  // Обновляем иконку
  if (currentTab && currentTab.id && currentTab.url) 
  {
    chrome.runtime.sendMessage({ action: "refresh_icon", tabId: currentTab.id, url: currentTab.url });
  }

});

el('btn-sync').addEventListener('click', async () => {
  const btnSync = el('btn-sync');
  btnSync.disabled = true;
  btnSync.textContent = "Syncing...";
  try {
    await syncWithGoogleDrive();
    btnSync.textContent = "Done!";
    setTimeout(() => { window.location.reload(); }, 1000);
  } catch (err) {
    btnSync.textContent = "Error";
    btnSync.disabled = false;
    setTimeout(() => { btnSync.textContent = "Sync"; }, 2000);
  }
});


async function getSelectedText() {
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    
    const result = await chrome.scripting.executeScript({
      target: {tabId: tab.id},
      func: () => window.getSelection().toString()
    });
    
    return result[0].result;
  } catch (e) {
    console.error("Не удалось получить выделенный текст", e);
    return "";
  }
}


function setupSecretField(field) {
  if (!field) return;
  field.type = 'password';

  field.addEventListener('focus', () => {
    field.type = 'text';
  });

  field.addEventListener('blur', () => {
    field.type = 'password';
  });
}

setupSecretField(passwordField);
setupSecretField(totpsecretField);



async function resetDashboard(appUid, pageNm) {

  const targetMarker = `#${appUid}_dashboard`;

  const baseUrl = chrome.runtime.getURL(pageNm);
  const fullUrl = baseUrl + targetMarker;

  const allDashboards = await chrome.tabs.query({ url: baseUrl + "*" });

  if (allDashboards.length > 0) {
    // Собираем их ID в один массив
    const idsToRemove = allDashboards.map(tab => tab.id);
    
    // 2. Закрываем нахрен все старые вкладки разом
    await chrome.tabs.remove(idsToRemove);
  }

}




document.getElementById('open-dashboard').addEventListener('click', (e) => {
  e.preventDefault();
  const appId = chrome.runtime.id;
  resetDashboard(appId, "dashboard.html");

  // chrome.tabs.create({ url: "dashboard.html" });
  // 
  chrome.tabs.create({ 
    url: "dashboard.html", 
    active: true 
  });

});





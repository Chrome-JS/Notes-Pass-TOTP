import { getRecord, saveRecord, deleteRecord } from './db.js';
import { initTotp, stopTotp } from './totp.js';
import { parseHostsText } from './utils.js';

let currentGuid = null;
const btnApply = document.getElementById('btn-apply');
const btnDelete = document.getElementById('btn-delete');
const formFields = ['login', 'password', 'secret', 'note', 'hosts'];



document.addEventListener('DOMContentLoaded', () => {

  renderTable();

  formFields.forEach(fieldId => {
    document.getElementById(fieldId).addEventListener('input', () => {
      btnApply.disabled = false;
    });
  });
});




async function renderTable() {

  const tbody = document.getElementById('records-table-body');
  tbody.innerHTML = '';

  const allData = await chrome.storage.local.get(null);
  
  // Берем только ключи-GUID (игнорируем служебные)
  const guids = Object.keys(allData).filter(key => key !== '__index' && key !== '__deleted');

  if (guids.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#999;">No records</td></tr>`;
    return;
  }

  guids.forEach(guid => {
    const record = allData[guid];
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    tr.dataset.guid = guid;
    if (currentGuid === guid) tr.classList.add('active-row');


    const hostsArray = parseHostsText(record.hosts || '');
    const hostsBadges = hostsArray.map(h => `<span class="hosts-badge">${h}</span>`).join(' ');

    tr.innerHTML = `
      <td class="guid-cell" title="${guid}">${guid.slice(0, 8)}...</td>
      <td title="${record.login || ''}">${record.login || '—'}</td>
      <td>${hostsBadges || '—'}</td>
      <td title="${record.note || ''}">${record.note || '—'}</td>
    `;

    tr.addEventListener('click', () => loadRecordIntoForm(guid));
    tbody.appendChild(tr);
  });
}



async function loadRecordIntoForm(guid) {

  currentGuid = guid;
  
  document.querySelectorAll('#records-table-body tr').forEach(tr => {
    tr.classList.remove('active-row');
    if (tr.dataset.guid === guid) tr.classList.add('active-row');
  });

  const record = await getRecord(guid);
  if (!record) return;


  document.getElementById('login').value = record.login || '';
  document.getElementById('password').value = record.password || '';
  document.getElementById('secret').value = record.secret || '';
  document.getElementById('note').value = record.note || '';
  document.getElementById('hosts').value = record.hosts || '';

  btnDelete.classList.remove('hidden');
  btnApply.disabled = true;

  if (record.secret) {
    initTotp(record.secret);
  } else {
    stopTotp();
  }
}



btnApply.addEventListener('click', async () => {

  if (!currentGuid) return;

  const login = document.getElementById('login').value.trim();
  const password = document.getElementById('password').value;
  const secret = document.getElementById('secret').value.trim();
  const note = document.getElementById('note').value;
  const hostsText = document.getElementById('hosts').value;

  const updatedRecord = {
    id: currentGuid,
    login,
    password,
    secret,
    note,
    hosts: hostsText,
    updatedAt: Date.now()
  };

  await saveRecord(currentGuid, updatedRecord, hostsText);

  if (secret) {
    initTotp(secret);
  } else {
    stopTotp();
  }

  btnApply.disabled = true;
  btnApply.textContent = chrome.i18n.getMessage("btn_Applied");
  btnApply.classList.add('btn-success');

  setTimeout(() => {
    btnApply.textContent = chrome.i18n.getMessage("btn_Apply");
    btnApply.classList.remove('btn-success');
  }, 1500);

  renderTable();
});




btnDelete.addEventListener('click', async () => {

  if (!currentGuid) return;

  await deleteRecord(currentGuid);
  stopTotp();

  formFields.forEach(id => { document.getElementById(id).value = ''; });
  btnDelete.classList.add('hidden');
  btnApply.disabled = true;
  currentGuid = null;

  renderTable();
});

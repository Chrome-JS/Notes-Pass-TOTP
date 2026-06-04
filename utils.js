// utils.js


// --- НОВАЯ ЛОГИКА: Возвращает МАССИВ GUID ---
export function findGuidForHost(currentHost, index) {
  if (!currentHost || !index) return [];
  
  const guids = [];
  
  // Хелпер для извлечения ID (поддержка старого и нового формата)
  const extractId = (item) => {
    if (typeof item === 'string') return item; // Старый формат: просто строка
    if (item && item.i) return item.i;         // Новый формат: объект { i: ID, p: Patterns }
    return null;
  };

  // 1. Прямое совпадение
  if (index[currentHost]) {
    const val = index[currentHost];
    if (Array.isArray(val)) {
      val.forEach(item => {
        const id = extractId(item);
        if (id) guids.push(id);
      });
    } else {
      const id = extractId(val);
      if (id) guids.push(val);
    }
  }
  
  // 2. Проверка поддоменов
  for (const savedHost in index) {
    // Пропускаем, если это тот же хост (уже проверили выше)
    if (savedHost === currentHost) continue;

    if (currentHost.endsWith('.' + savedHost)) {
      const val = index[savedHost];
      if (Array.isArray(val)) {
        val.forEach(item => {
          const id = extractId(item);
          if (id) guids.push(id);
        });
      } else {
        const id = extractId(val);
        if (id) guids.push(val);
      }
    }
  }
  
  // Возвращаем уникальный список строк (ID)
  return [...new Set(guids)];
}



export function parseHostsText(text) {
  if (!text) return [];
  return text.split('\n').map(s => s.trim()).filter(s => s.length > 0);
}

export function getHostFromUrl(url) {
  try {
    const urlObj = new URL(url);
    if (urlObj.protocol === 'file:') return `file://${urlObj.pathname.toLowerCase()}`;
    return urlObj.hostname;
  } catch (e) { return null; }
}

// Единая функция проверки для Бейджа и Попапа
export function matchUrlPatterns(currentUrl, patternsText) {
  // 1. Если паттернов нет совсем — считаем, что подходит (глобально для сайта)
  if (!patternsText || patternsText.trim() === '') return true;

  let url;
  try { url = new URL(currentUrl); } catch (e) { return false; }

  const path = url.pathname;
  const search = url.search;
  const hash = url.hash;
  const patterns = patternsText.split('\n').map(p => p.trim()).filter(Boolean);

  for (const p of patterns) {

    // 2. ВАЛИДАЦИЯ: Если нет спецсимволов — СТРОКА НЕВАЛИДНА, ИГНОРИРУЕМ ЕЁ
    if (!p.includes('*') && !p.includes('&') && !p.includes('#')) {
      continue; // Просто пропускаем эту строку, она брак
    }

    // 3. Проверка Query (&...)
    if (p.startsWith('&')) {
      // Трюк: добавляем & в начало search, чтобы первый параметр тоже находился.
      // ?token=1 превращается в строку "&token=1" для поиска.

      const searchNormalized = '&' + search.substring(1);       
      if (searchNormalized.includes(p)) return true;
    } 

    // 4. Проверка Hash (#...)
    else if (p.startsWith('#')) {
      if (hash.includes(p)) return true;
    } 
    // 5. Проверка Path (содержит *)
    else {

      // Разбиваем паттерн на части по звездочке
      const parts = p.split("*");
      const countAstr = parts.length - 1;

      // *foo
      if (countAstr === 1 && p.startsWith('*')) {
        if (path.endsWith(parts[1])) return true;
      } 

      // foo*
      else if (countAstr === 1 && p.endsWith('*')) {
        if (path.startsWith(parts[0])) return true;
      }

      // *foo*
      else if (countAstr === 2 && p.startsWith('*') && p.endsWith('*')) {
        const midS = parts[1]; // Берем то, что между звездочками
        if (path.includes(midS)) return true;
      }

       // foo*bar
       else if (countAstr === 1) {
         const start = parts[0];
         const end = parts[1];
         // Проверяем, что путь начинается с первой части И заканчивается второй
         if (path.startsWith(start) && path.endsWith(end)) return true;
       }
    }
  }

  // Если мы здесь — значит валидных паттернов не было или ни один не подошел
  return false;
}


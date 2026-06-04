      let curTexts = {};

      function switchLang(curLng)
      {
        curTexts = translations[curLng];
      }

      function tr(key, vars = {})
      {
        let str = curTexts?.[key] || key;

        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(`{${k}}`, v);
        }
         return str;
      }





document.querySelectorAll('[data-i18n]').forEach(element => {
  const key = element.getAttribute('data-i18n');
  const translation = chrome.i18n.getMessage(key);

  if (element.matches('input[type="button"], input[type="submit"]')) {
    element.value = translation;
  } else {
    element.textContent = translation;
  }

});

document.querySelectorAll('[data-i18n-ph]').forEach(element => {
  const key = element.getAttribute('data-i18n-ph');
  const translation = chrome.i18n.getMessage(key);
  element.placeholder = translation;
});

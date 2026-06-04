// totp.js

let totpInterval = null;

export function initTotp(secret) {
  stopTotp(); // Сбрасываем старый таймер, если он был
  
  const cleanSecret = secret.replace(/\s+/g, '').toUpperCase();
  if (!cleanSecret) return;

  const container = document.getElementById('totp-container');
  if (container) container.classList.remove('hidden');

  let totp;
  try {
    // Используем глобальный OTPAuth, подключенный в HTML
    totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(cleanSecret),
      digits: 6,
      period: 30,
      algorithm: 'SHA1'
    });
  } catch (e) {
    console.error('Ошибка TOTP:', e);
    const field = document.getElementById('totp-field');
    if (field) field.value = "ERR SECRET";
    return;
  }

  const updateWidget = () => {
    const now = Date.now();
    const remainingSeconds = 30 - (Math.floor(now / 1000) % 30);
    const progressPercent = (remainingSeconds / 30) * 100;
    
    const fill = document.getElementById('progress-fill');
    if (fill) fill.style.width = `${progressPercent}%`;

    try {
      const code = totp.generate();
      const formattedCode = code.slice(0, 3) + ' ' + code.slice(3);
      const field = document.getElementById('totp-field');
      if (field) field.value = formattedCode;
    } catch (err) {
      const field = document.getElementById('totp-field');
      if (field) field.value = "ERROR";
    }
  };

  updateWidget();
  totpInterval = setInterval(updateWidget, 1000);
}

export function stopTotp() {
  if (totpInterval) {
    clearInterval(totpInterval);
    totpInterval = null;
  }
  const container = document.getElementById('totp-container');
  if (container) container.classList.add('hidden');
}

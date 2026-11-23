// Keeps the website and phone app on the newest version.
// Browsers keep a saved copy of the site (for speed and offline use), so an open
// tab could stay on an old version for days. This checks for a new version when
// the app opens, every 10 minutes, and whenever the tab comes back into view,
// then switches over by itself, but never while a form (pop-up) is open.

export async function keepUpToDate() {
  if (import.meta.env.TAURI_ENV_PLATFORM || !('serviceWorker' in navigator)) return; // desktop apps update themselves
  const { registerSW } = await import('virtual:pwa-register');
  let waiting = false;
  const busy = () => !!document.querySelector('.modal, .overlay');
  const switchWhenFree = () => {
    if (!busy() || document.visibilityState === 'hidden') return void updateSW(true); // reloads into the new version
    setTimeout(switchWhenFree, 5000);
  };
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      if (waiting) return;
      waiting = true;
      switchWhenFree();
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => {
        if (navigator.onLine) reg.update().catch(() => undefined);
      };
      setInterval(check, 10 * 60 * 1000);
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
    },
  });
}

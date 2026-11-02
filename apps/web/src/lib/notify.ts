import { backend } from '../data/store';

// Desktop notification when a new Monday summary arrives (works in the
// desktop app and in browsers), plus phone/browser push via the service worker.

// Inside the desktop app, notifications go through Tauri's notification plugin.
const isTauri = '__TAURI_INTERNALS__' in window;

export async function askNotificationPermission(): Promise<boolean> {
  if (isTauri) {
    const n = await import('@tauri-apps/plugin-notification');
    return (await n.isPermissionGranted()) || (await n.requestPermission()) === 'granted';
  }
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  return (await Notification.requestPermission()) === 'granted';
}

export function showNotification(title: string, body: string) {
  if (isTauri) {
    import('@tauri-apps/plugin-notification').then((n) => n.sendNotification({ title, body }));
    return;
  }
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, icon: '/icon-192.png' });
  } catch {
    navigator.serviceWorker?.ready.then((r) => r.showNotification(title, { body, icon: '/icon-192.png' }));
  }
}

function urlB64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Turns on push messages for this browser (phone or computer). */
export async function enablePush(): Promise<'ok' | 'denied' | 'unsupported'> {
  if (!(await askNotificationPermission())) return 'denied';
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (isTauri || !key || !('serviceWorker' in navigator) || !('PushManager' in window) || !backend.savePushSubscription) return 'ok';
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(key) }));
  await backend.savePushSubscription(sub);
  return 'ok';
}

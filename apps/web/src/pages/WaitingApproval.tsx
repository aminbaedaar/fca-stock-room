import { useEffect, useState } from 'react';
import { backend, useStore } from '../data/store';
import { t } from '../i18n';

/** Shown to a new account until the Admin approves it on the Team page. */
export function WaitingApproval() {
  const { me, refreshMe } = useStore();
  const [busy, setBusy] = useState(false);

  // Look again every 30 seconds, so the app opens by itself once approved.
  useEffect(() => {
    const timer = setInterval(() => refreshMe(), 30_000);
    return () => clearInterval(timer);
  }, [refreshMe]);

  const check = async () => {
    setBusy(true);
    await refreshMe();
    setBusy(false);
  };

  return (
    <div className="login">
      <div className="card stack">
        <img src="/logo-full.png" alt={t('app.company')} />
        <h1 style={{ textAlign: 'center' }}>{t('auth.waitTitle')}</h1>
        <p style={{ margin: 0 }}>{t('auth.waitText')}</p>
        <p className="muted small" style={{ margin: 0 }}>{me?.name} · {me?.email}</p>
        <button className="btn primary" disabled={busy} onClick={check}>{t('auth.checkAgain')}</button>
        <button className="btn" onClick={() => backend.signOut()}>{t('auth.signOut')}</button>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { ROLE_LABELS, type Role } from '@fca/core';
import { backend, useStore } from '../data/store';
import { t } from '../i18n';
import { Toasts } from '../components/ui';

type Mode = 'signin' | 'signup' | 'forgot' | 'reset';

export function Login({ reset = false }: { reset?: boolean }) {
  const { refreshMe } = useStore();
  const [mode, setMode] = useState<Mode>(reset ? 'reset' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    setInfo('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = () =>
    run(async () => {
      if (mode === 'signin') await backend.signIn(email, password);
      else if (mode === 'signup') {
        if (password.length < 8) throw new Error('Use at least 8 characters for the password.');
        const r = await backend.signUp(email, password, name);
        if (r === 'check-email') {
          setInfo(t('auth.checkEmail'));
          setMode('signin');
        }
      } else if (mode === 'forgot') {
        await backend.sendPasswordReset(email);
        setInfo(t('auth.resetSent'));
      } else {
        if (password.length < 8) throw new Error('Use at least 8 characters for the password.');
        await backend.updatePassword(password);
        history.replaceState(null, '', '/');
        await refreshMe();
      }
    });

  const demo = backend.mode === 'demo';

  return (
    <div className="login">
      <div className="card stack">
        <img src="/logo-full.png" alt={t('app.company')} />
        <h1 style={{ textAlign: 'center' }}>{t('app.name')}</h1>

        {demo ? (
          <>
            <p className="muted" style={{ textAlign: 'center', margin: 0 }}>{t('auth.demoAs')}</p>
            {(['admin', 'boss', 'manager', 'staff', 'viewer'] as Role[]).map((r) => (
              <button key={r} className={`btn${r === 'admin' ? ' primary' : ''}`} onClick={() => run(() => backend.demoSignIn!(r))}>
                {ROLE_LABELS[r]}
              </button>
            ))}
            <p className="muted small" style={{ margin: 0 }}>{t('banner.demo')}</p>
          </>
        ) : (
          <form className="stack" onSubmit={(e) => (e.preventDefault(), submit())}>
            {mode === 'signup' && (
              <label className="field">
                <span>{t('auth.name')}</span>
                <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
              </label>
            )}
            {mode !== 'reset' && (
              <label className="field">
                <span>{t('auth.email')}</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
              </label>
            )}
            {mode !== 'forgot' && (
              <label className="field">
                <span>{mode === 'reset' ? t('auth.newPassword') : t('auth.password')}</span>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
              </label>
            )}
            {error && <p className="err" role="alert">{error}</p>}
            {info && <p className="pos small" role="status">{info}</p>}
            <button className="btn primary" disabled={busy}>
              {mode === 'signin' ? t('auth.signIn') : mode === 'signup' ? t('auth.signUp') : mode === 'forgot' ? t('auth.sendReset') : t('auth.setPassword')}
            </button>
            {(mode === 'signin' || mode === 'signup') && (
              <>
                <div className="divider">or</div>
                <button type="button" className="btn" onClick={() => run(() => backend.signInWithGoogle())}>
                  {t('auth.google')}
                </button>
              </>
            )}
            <div className="row small" style={{ justifyContent: 'space-between' }}>
              {mode === 'signin' ? (
                <>
                  <a href="#" onClick={(e) => (e.preventDefault(), setMode('signup'))}>{t('auth.signUp')}</a>
                  <a href="#" onClick={(e) => (e.preventDefault(), setMode('forgot'))}>{t('auth.forgot')}</a>
                </>
              ) : (
                <a href="#" onClick={(e) => (e.preventDefault(), setMode('signin'))}>← {t('auth.signIn')}</a>
              )}
            </div>
          </form>
        )}
      </div>
      <Toasts />
    </div>
  );
}

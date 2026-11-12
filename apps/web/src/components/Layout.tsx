import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { can, ROLE_LABELS } from '@fca/core';
import { backend, useStore } from '../data/store';
import { resetDemo } from '../data/demo';
import { enablePush } from '../lib/notify';
import { t } from '../i18n';
import { AiDrawer } from './AiDrawer';
import { Avatar, Toasts } from './ui';

type Theme = 'system' | 'light' | 'dark';

function applyTheme(theme: Theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

export function Layout() {
  const { me, data, online, pending, toast } = useStore();
  const [ai, setAi] = useState(false);
  const [menu, setMenu] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem('fca.theme') as Theme) || 'system';
    } catch {
      return 'system';
    }
  });
  const navigate = useNavigate();
  const pendingRequests = data.requests.filter((r) => r.status === 'pending').length;

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem('fca.theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu]);

  if (!me) return null;

  const links: [string, string, number?][] = [
    ['/', t('nav.dashboard')],
    ['/stock', t('nav.stock')],
    ['/movements', t('nav.movements')],
    ['/requests', t('nav.requests'), pendingRequests],
    ['/calculator', t('nav.calculator')],
    ['/jobs', t('nav.jobs')],
    ['/team', t('nav.team')],
  ];

  return (
    <>
      <div className="brandbar" />
      <header className="header">
        <div className="header-inner">
          <NavLink to="/" className="logo" aria-label={t('app.name')}>
            <img src="/logo-mark.png" alt="" />
            <span className="hide-sm">
              <b>{t('app.name')}</b>
              <small>{t('app.company')}</small>
            </span>
          </NavLink>
          <span className="spacer" />
          <button className="btn brand" onClick={() => setAi(true)}>
            ✨ <span>{t('nav.askAi')}</span>
          </button>
          <button
            className="user"
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={(e) => {
              e.stopPropagation();
              setMenu((m) => !m);
            }}
          >
            <Avatar member={me} />
            <span className="user-text hide-sm">
              {me.name || me.email}
              <small>{ROLE_LABELS[me.role]}</small>
            </span>
          </button>
          {menu && (
            <div className="menu" role="menu" onClick={(e) => e.stopPropagation()}>
              <div style={{ padding: '6px 10px' }}>
                <b>{me.name}</b>
                <div className="muted small">
                  {me.email} · {ROLE_LABELS[me.role]}
                </div>
              </div>
              <button role="menuitem" onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark')}>
                Theme: {theme === 'system' ? 'Automatic' : theme === 'dark' ? 'Dark' : 'Light'}
              </button>
              <button
                role="menuitem"
                onClick={async () => {
                  const r = await enablePush().catch(() => 'unsupported' as const);
                  toast(r === 'ok' ? 'Notifications are on for this device.' : r === 'denied' ? 'Notifications are blocked in this browser settings.' : 'Notifications are not supported here.', r === 'ok' ? 'ok' : 'error');
                  setMenu(false);
                }}
              >
                Turn on notifications
              </button>
              <button role="menuitem" onClick={() => (setMenu(false), navigate('/print'))}>
                {t('stock.printSheet')}
              </button>
              {can(me.role, 'import') && (
                <button role="menuitem" onClick={() => (setMenu(false), navigate('/import'))}>
                  {t('team.import')}
                </button>
              )}
              {backend.mode === 'demo' && (
                <button
                  role="menuitem"
                  onClick={() => {
                    if (confirm('Reset demo data back to the Excel import?')) {
                      resetDemo();
                      location.reload();
                    }
                  }}
                >
                  Reset demo data
                </button>
              )}
              <button role="menuitem" onClick={() => backend.signOut()}>
                {t('auth.signOut')}
              </button>
            </div>
          )}
        </div>
        <nav className="nav" aria-label="Main">
          {links.map(([to, label, badge]) => (
            <NavLink key={to} to={to} end={to === '/'}>
              {label}
              {!!badge && <span className="badge" aria-label={`${badge} pending`}>{badge}</span>}
            </NavLink>
          ))}
        </nav>
      </header>
      {!online && <div className="banner offline">{t('banner.offline')}{pending ? ` ${t('banner.pending', { n: pending })}` : ''}</div>}
      {online && pending > 0 && <div className="banner demo">{t('banner.pending', { n: pending })}</div>}
      {backend.mode === 'demo' && <div className="banner demo no-print">{t('banner.demo')}</div>}
      <main>
        <Outlet />
      </main>
      {ai && <AiDrawer onClose={() => setAi(false)} />}
      <Toasts />
    </>
  );
}

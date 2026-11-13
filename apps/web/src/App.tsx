import { useEffect, useRef } from 'react';
import { can } from '@fca/core';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { StoreProvider, useStore } from './data/store';
import { showNotification } from './lib/notify';
import { t } from './i18n';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Stock } from './pages/Stock';
import { Movements } from './pages/Movements';
import { Requests } from './pages/Requests';
import { Jobs } from './pages/Jobs';
import { Team } from './pages/Team';
import { Import } from './pages/Import';
import { PrintSheet } from './pages/PrintSheet';
import { Calculator } from './pages/Calculator';

/** Shows a desktop notification when a new Monday summary arrives. */
function ReportWatcher() {
  const { data, loaded } = useStore();
  const seen = useRef<string | null>(null);
  const latest = data.reports[0];
  useEffect(() => {
    if (!loaded) return;
    if (seen.current && latest && latest.id !== seen.current && latest.source === 'scheduled') {
      showNotification('Monday stock summary', 'The weekly summary is ready. Open First Choice Africa Ltd to read it.');
    }
    seen.current = latest?.id ?? '';
  }, [latest?.id, loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function Shell() {
  const { me, authReady, loaded } = useStore();
  const resetting = new URLSearchParams(location.search).has('reset');
  if (!authReady) return <div className="login muted">{t('common.loading')}</div>;
  if (!me) return <Login />;
  if (resetting) return <Login reset />;
  if (!loaded) return <div className="login muted">{t('common.loading')}</div>;
  // "Calculator only": the job calculator and nothing else.
  if (!can(me.role, 'view'))
    return (
      <Routes>
        <Route element={<Layout />}>
          <Route path="calculator" element={<Calculator />} />
          <Route path="*" element={<Navigate to="/calculator" replace />} />
        </Route>
      </Routes>
    );
  return (
    <>
      <ReportWatcher />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="stock" element={<Stock />} />
          <Route path="movements" element={<Movements />} />
          <Route path="requests" element={<Requests />} />
          <Route path="calculator" element={<Calculator />} />
          <Route path="jobs" element={<Jobs />} />
          {can(me.role, 'roles') && <Route path="team" element={<Team />} />}
          <Route path="import" element={<Import />} />
          <Route path="print" element={<PrintSheet />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
  );
}

export function App() {
  return (
    <StoreProvider>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </StoreProvider>
  );
}

import { Fragment } from 'react';
import { CATEGORIES, fmtDate, kigaliDay } from '@fca/core';
import { t } from '../i18n';
import { useItemStats } from '../components/ui';

/** Printable stock-take sheet: item, size, unit and a blank count column. */
export function PrintSheet() {
  const { items } = useItemStats();
  return (
    <>
      <div className="page-head no-print">
        <h1>{t('stock.printSheet')}</h1>
        <span className="spacer" />
        <button className="btn primary" onClick={() => window.print()}>{t('common.print')}</button>
      </div>
      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <img src="/logo-mark.png" alt="" style={{ height: 32 }} />
          <div>
            <h2>Stock take · {t('app.company')}</h2>
            <span className="muted small">Printed {fmtDate(kigaliDay())} · Counted by: ____________________ · Date: ____________</span>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th style={{ width: '45%' }}>{t('common.item')}</th>
              <th>{t('common.size')}</th>
              <th>{t('common.unit')}</th>
              <th style={{ width: '22%' }}>Count</th>
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map((cat) => {
              const rows = items.filter((i) => i.category === cat);
              if (!rows.length) return null;
              return (
                <Fragment key={cat}>
                  <tr className="group">
                    <td colSpan={4}>{cat}</td>
                  </tr>
                  {rows.map((i) => (
                    <tr key={i.id}>
                      <td>{i.name}</td>
                      <td>{i.size}</td>
                      <td>{i.unit}</td>
                      <td />
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

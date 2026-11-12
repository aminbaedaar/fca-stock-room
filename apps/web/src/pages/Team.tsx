import { Link } from 'react-router-dom';
import { can, fmtDateTime, PERMISSION_ROWS, ROLE_HELP, ROLE_LABELS, ROLES, type Role } from '@fca/core';
import { newId, useStore } from '../data/store';
import { exportBackup } from '../lib/exports';
import { t } from '../i18n';
import { Avatar } from '../components/ui';

export function Team() {
  const { data, me, dispatch, toast } = useStore();
  const isAdmin = can(me?.role, 'roles');
  const members = [...data.members].sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.name.localeCompare(b.name));

  const setRole = (user_id: string, role: Role) => {
    if (dispatch({ kind: 'setRole', id: newId(), user_id, role })) toast('Role updated');
  };

  return (
    <>
      <div className="page-head">
        <h1>{t('team.title')}</h1>
        <span className="spacer" />
        {can(me?.role, 'import') && <Link className="btn" to="/import">{t('team.import')}</Link>}
        {can(me?.role, 'backup') && <button className="btn" onClick={() => exportBackup(data)}>{t('team.backup')}</button>}
      </div>
      <div className="grid grid-2">
        <section className="card">
          <div className="card-head">
            <h2>People</h2>
            <span className="muted small">Everyone who has signed in. New people start as Staff.</span>
          </div>
          <div className="list">
            {members.map((m) => (
              <div className="list-row" key={m.user_id}>
                <Avatar member={m} />
                <div className="main">
                  <b>{m.name || m.email}{m.user_id === me?.user_id ? ' (you)' : ''}</b>
                  <span className="muted small">
                    {m.email}
                    {m.last_seen ? ` · ${t('team.lastSeen')} ${fmtDateTime(m.last_seen)}` : ''}
                  </span>
                </div>
                {isAdmin ? (
                  <select value={m.role} onChange={(e) => setRole(m.user_id, e.target.value as Role)} style={{ width: 'auto' }} aria-label={`Role for ${m.name}`}>
                    {ROLES.map((r) => <option key={r} value={r} title={ROLE_HELP[r]}>{ROLE_LABELS[r]}</option>)}
                  </select>
                ) : (
                  <span className="pill rejected">{ROLE_LABELS[m.role]}</span>
                )}
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <div className="card-head">
            <h2>{t('team.permissions')}</h2>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Action</th>
                  {ROLES.map((r) => <th key={r} style={{ textAlign: 'center' }}>{ROLE_LABELS[r]}</th>)}
                </tr>
              </thead>
              <tbody>
                {PERMISSION_ROWS.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    {ROLES.map((r) => (
                      <td key={r} style={{ textAlign: 'center' }} aria-label={can(r, row.perm) ? 'yes' : 'no'}>
                        {can(r, row.perm) ? <span className="pos">✓</span> : <span className="muted">–</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {ROLES.map((r) => (
              <li key={r}>
                <b>{ROLE_LABELS[r]}</b>: {ROLE_HELP[r]}
              </li>
            ))}
          </ul>
          <p className="muted small">These rules are enforced by the database itself, not just by hiding buttons.</p>
        </section>
      </div>
    </>
  );
}

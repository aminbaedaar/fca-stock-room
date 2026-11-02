// Writes the Monday summary, saves it to "reports", emails it to Admins,
// Bosses and Managers, and sends a push notification.
// Called by the weekly schedule (header x-cron-secret) or by the
// "Write summary now" button (a signed-in user allowed to do so).
import webpush from 'npm:web-push@3.6.7';
import { admin, caller, cors, json, loadItems, loadMoves, loadPendingRequests } from '../_shared/server.ts';
import { buildMondayReport, can, fmtDate, kigaliDay } from '../_shared/core/index.ts';

const NOTIFY_ROLES = ['admin', 'boss', 'manager'];

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** Simple markdown → HTML for the email (headings, tables, lists, bold, italic). */
function emailHtml(md: string, appUrl: string): string {
  const inline = (s: string) => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/_(.+?)_/g, '<i>$1</i>');
  const out: string[] = [];
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('### ')) out.push(`<h3 style="color:#9B165F;margin:18px 0 6px">${inline(l.slice(4))}</h3>`);
    else if (l.startsWith('## ')) out.push(`<h2 style="margin:0 0 8px">${inline(l.slice(3))}</h2>`);
    else if (l.startsWith('|')) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      i--;
      const cells = (r: string) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const [head, , ...body] = rows;
      out.push(
        '<table cellpadding="6" style="border-collapse:collapse;font-size:13px">' +
          `<tr>${cells(head).map((c) => `<th align="left" style="border-bottom:1px solid #ddd">${inline(c)}</th>`).join('')}</tr>` +
          body.map((r) => `<tr>${cells(r).map((c) => `<td style="border-bottom:1px solid #eee">${inline(c)}</td>`).join('')}</tr>`).join('') +
          '</table>',
      );
    } else if (l.startsWith('- ')) out.push(`<p style="margin:4px 0">• ${inline(l.slice(2))}</p>`);
    else if (l.trim()) out.push(`<p style="margin:6px 0">${inline(l)}</p>`);
  }
  return `<div style="font-family:Poppins,Arial,sans-serif;color:#1f1724;max-width:640px">
    <div style="height:4px;background:linear-gradient(90deg,#601E62,#9B165F,#D21359,#E7441F,#EE8115,#F4AF0D)"></div>
    <div style="padding:16px 0">${out.join('\n')}</div>
    ${appUrl ? `<p><a href="${escapeHtml(appUrl)}" style="color:#9B165F">Open FCA Stock Room</a></p>` : ''}
  </div>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const db = admin();
  const cronSecret = Deno.env.get('CRON_SECRET');
  const fromCron = !!cronSecret && req.headers.get('x-cron-secret') === cronSecret;
  if (!fromCron) {
    const me = await caller(req, db);
    if (!me || !can(me.role, 'summary')) return json({ error: 'Your role cannot write the summary.' }, 403);
  }
  const source = fromCron ? 'scheduled' : 'manual';

  const [items, moves, requests] = await Promise.all([loadItems(db, 200), loadMoves(db, 14), loadPendingRequests(db)]);
  const text = buildMondayReport({ items, moves, requests });
  const id = kigaliDay();
  const { error } = await db.from('reports').upsert({ id, date: id, text, source, created_at: new Date().toISOString() });
  if (error) return json({ error: error.message }, 500);

  const { data: people } = await db.from('members').select('user_id, email, role').in('role', NOTIFY_ROLES);
  const results: Record<string, unknown> = {};

  // Email (Resend). Optional: skipped if no key is set.
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('SUMMARY_FROM_EMAIL') ?? 'FCA Stock Room <onboarding@resend.dev>';
  const to = (people ?? []).map((p) => p.email).filter(Boolean);
  if (resendKey && to.length && source === 'scheduled') {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to,
        subject: `Monday stock summary · ${fmtDate(id)}`,
        html: emailHtml(text, Deno.env.get('APP_URL') ?? ''),
        text,
      }),
    });
    results.email = r.ok ? `sent to ${to.length}` : `failed: ${await r.text()}`;
  }

  // Push notifications (phones and browsers). Optional: needs VAPID keys.
  const pub = Deno.env.get('VAPID_PUBLIC_KEY');
  const priv = Deno.env.get('VAPID_PRIVATE_KEY');
  if (pub && priv && source === 'scheduled') {
    webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com', pub, priv);
    const ids = (people ?? []).map((p) => p.user_id);
    const { data: subs } = await db.from('push_subscriptions').select('*').in('user_id', ids);
    let sent = 0;
    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: 'Monday stock summary', body: 'The weekly summary is ready.', url: Deno.env.get('APP_URL') ?? '/' }),
        );
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
      }
    }
    results.push = `sent to ${sent}`;
  }

  return json({ ok: true, id, source, ...results });
});

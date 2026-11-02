import { useEffect, useRef, useState } from 'react';
import { fmtQty, itemLabel } from '@fca/core';
import { backend, newId, useStore } from '../data/store';
import type { AiMessage, AiProposal } from '../data/types';
import { Markdown } from '../lib/md';
import { t } from '../i18n';

type Entry = { role: 'user' | 'assistant'; text: string; proposals?: AiProposal[]; error?: boolean };

const SUGGESTIONS = [
  'How many glossy 1.27 rolls do we have?',
  'What should I order this week?',
  'What is running low?',
  'Which clients used the most material this month?',
];

export function AiDrawer({ onClose }: { onClose: () => void }) {
  const { data, me, dispatch, online } = useStore();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [history, setHistory] = useState<AiMessage[]>([]);
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [entries, busy]);

  const send = async (text: string) => {
    if (!text.trim() || busy || !me) return;
    // Answer any open proposals from the last reply (confirmed or not).
    const last = history[history.length - 1];
    const openIds =
      last?.role === 'assistant' && Array.isArray(last.content)
        ? (last.content as { type: string; id?: string }[]).filter((b) => b.type === 'tool_use').map((b) => b.id!)
        : [];
    const content = [
      ...openIds.map((id) => ({ type: 'tool_result', tool_use_id: id, content: outcomes[id] ?? 'The user did not confirm this. Nothing was saved.' })),
      { type: 'text', text: text.trim() },
    ];
    const next: AiMessage[] = [...history, { role: 'user', content }];
    setHistory(next);
    setEntries((e) => [...e, { role: 'user', text: text.trim() }]);
    setInput('');
    setBusy(true);
    try {
      const reply = await backend.ai(next, data, me);
      setHistory([...next, { role: 'assistant', content: reply.assistant_content }]);
      setEntries((e) => [...e, { role: 'assistant', text: reply.text, proposals: reply.proposals }]);
    } catch (err) {
      setHistory(history); // drop the failed question so the chat stays valid
      setEntries((e) => [...e, { role: 'assistant', text: (err as Error).message || 'Something went wrong.', error: true }]);
    } finally {
      setBusy(false);
    }
  };

  const confirm = (p: AiProposal) => {
    const ok = dispatch({
      kind: 'move',
      id: newId(),
      at: new Date().toISOString(),
      item_id: p.item_id,
      type: p.type,
      qty: p.qty,
      metres: p.metres,
      client: p.client,
      job: p.job,
      note: p.note || 'Recorded with AI assistant',
    });
    setOutcomes((o) => ({ ...o, [p.tool_use_id]: ok ? 'The user confirmed and the movement was saved.' : 'Saving failed; nothing was saved.' }));
  };
  const dismiss = (p: AiProposal) => setOutcomes((o) => ({ ...o, [p.tool_use_id]: 'The user chose not to save this.' }));

  const reset = () => {
    setEntries([]);
    setHistory([]);
    setOutcomes({});
  };

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={t('ai.title')}>
        <div className="drawer-head">
          <h2>✨ {t('ai.title')}</h2>
          <span className="spacer" />
          <button className="btn small" onClick={reset}>{t('ai.newChat')}</button>
          <button className="btn ghost icon" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>
        <div className="drawer-body" ref={bodyRef} aria-live="polite">
          {entries.length === 0 && (
            <>
              <p className="muted">Ask about stock in plain words, or tell me what was used. I'll show a card to confirm before anything is saved.</p>
              <div className="chips">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="chip" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </>
          )}
          {entries.map((e, n) => (
            <div key={n} style={{ display: 'grid', gap: 8 }}>
              <div className={`msg ${e.role}`} style={e.error ? { color: 'var(--out)' } : undefined}>
                {e.role === 'assistant' ? <Markdown text={e.text} /> : e.text}
              </div>
              {e.proposals?.map((p) => {
                const item = data.items.find((i) => i.id === p.item_id);
                const done = outcomes[p.tool_use_id];
                return (
                  <div className="proposal" key={p.tool_use_id}>
                    <b>{p.type === 'out' ? t('move.out') : t('move.in')}</b>
                    <dl>
                      <dt>{t('common.item')}</dt>
                      <dd>{item ? itemLabel(item) : 'Unknown item'}</dd>
                      <dt>{t('common.qty')}</dt>
                      <dd>
                        {fmtQty(p.qty)} {item?.unit}
                        {p.metres ? ` (${fmtQty(p.metres)} m)` : ''}
                      </dd>
                      {p.client && <><dt>{t('common.client')}</dt><dd>{p.client}</dd></>}
                      {p.job && <><dt>{t('common.job')}</dt><dd>{p.job}</dd></>}
                      {p.note && <><dt>{t('common.note')}</dt><dd>{p.note}</dd></>}
                    </dl>
                    {done ? (
                      <span className="muted small">{done.includes('saved.') && !done.includes('nothing') ? `✓ ${t('ai.saved')}` : done}</span>
                    ) : (
                      <div className="row">
                        <button className="btn primary small" onClick={() => confirm(p)} disabled={!item}>{t('ai.confirm')}</button>
                        <button className="btn small" onClick={() => dismiss(p)}>{t('ai.dismiss')}</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {busy && <div className="msg assistant muted">Thinking…</div>}
        </div>
        <form className="drawer-foot" onSubmit={(e) => (e.preventDefault(), send(input))}>
          {!online && <span className="small muted">You are offline. The assistant needs the internet.</span>}
          <textarea
            ref={inputRef}
            rows={2}
            value={input}
            placeholder={t('ai.placeholder')}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
          />
          <button className="btn brand" disabled={busy || !input.trim()}>Send</button>
        </form>
      </aside>
    </>
  );
}

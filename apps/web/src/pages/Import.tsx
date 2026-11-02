import { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { can, CATEGORIES, fmtDate, fmtQty, importList, importSheets, UNITS, type Alignment, type Category, type ColumnMap, type ImportedItem, type Unit } from '@fca/core';
import { newId, useStore } from '../data/store';
import { readWorkbook } from '../lib/excel';
import { t } from '../i18n';
import { Field } from '../components/ui';

type Sheets = Awaited<ReturnType<typeof readWorkbook>>;
type Format = 'weekly' | 'list';

const FIELDS: [keyof ColumnMap, string, boolean][] = [
  ['name', 'Name', true],
  ['size', 'Size', false],
  ['category', 'Category', false],
  ['unit', 'Unit', false],
  ['qty', 'Quantity', true],
  ['min', 'Minimum', false],
  ['note', 'Note', false],
];

export function Import() {
  const { me, dispatch, toast, data } = useStore();
  const [sheets, setSheets] = useState<Sheets | null>(null);
  const [fileName, setFileName] = useState('');
  const [format, setFormat] = useState<Format>('weekly');
  const [alignment, setAlignment] = useState<Alignment>('aligned');
  const [listSheet, setListSheet] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [map, setMap] = useState<Partial<ColumnMap>>({});
  const [edits, setEdits] = useState<Record<number, Partial<ImportedItem>>>({});
  const [skip, setSkip] = useState<Set<number>>(new Set());

  const result = useMemo(() => {
    if (!sheets) return null;
    if (format === 'weekly') return importSheets(sheets, { alignment });
    if (map.name == null || map.qty == null) return null;
    return importList(sheets[listSheet].rows, map as ColumnMap, headerRow, sheets[listSheet].name);
  }, [sheets, format, alignment, listSheet, headerRow, map]);

  const rows = (result?.items ?? []).map((r, i) => ({ ...r, ...edits[i] }));
  const existing = new Set(data.items.filter((i) => i.active).map((i) => `${i.name}|${i.size}`));

  if (!can(me?.role, 'import')) return <Navigate to="/" replace />;

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const s = await readWorkbook(f);
      setSheets(s);
      setFileName(f.name);
      setEdits({});
      setSkip(new Set());
      // Guess the list format's header row and columns.
      const hr = s[0].rows.findIndex((r) => r?.some((c) => /^(name|item|description)$/i.test(String(c ?? '').trim())));
      if (hr >= 0) {
        setHeaderRow(hr);
        const head = s[0].rows[hr].map((c) => String(c ?? '').toLowerCase().trim());
        const find = (re: RegExp) => {
          const i = head.findIndex((h) => re.test(h));
          return i >= 0 ? i : undefined;
        };
        setMap({ name: find(/^(name|item|description)$/), size: find(/size/), category: find(/categ/), unit: find(/unit/), qty: find(/^(qty|quantity|stock|in stock|pcs)$/), min: find(/^min/), note: find(/note/) });
      }
    } catch (e) {
      toast(`Could not read the file: ${(e as Error).message}`, 'error');
    }
  };

  const save = () => {
    const chosen = rows.filter((_, i) => !skip.has(i));
    if (!chosen.length) return;
    if (!confirm(`Import ${chosen.length} items? Items that already exist (same name and size) only get their count history added.`)) return;
    const ok = dispatch({
      kind: 'import',
      id: newId(),
      rows: chosen.map((r) => ({ name: r.name, size: r.size, category: r.category, unit: r.unit, qty: r.qty, min_level: r.min_level, note: r.note, counts: r.counts })),
    });
    if (ok) {
      toast(`Imported ${chosen.length} items`);
      setSheets(null);
    }
  };

  const edit = (i: number, patch: Partial<ImportedItem>) => setEdits((e) => ({ ...e, [i]: { ...e[i], ...patch } }));
  const header = sheets?.[listSheet].rows[headerRow] ?? [];

  return (
    <>
      <div className="page-head">
        <h1>{t('team.import')}</h1>
      </div>
      <div className="card stack">
        <p className="muted" style={{ margin: 0 }}>
          Choose your stock Excel file. Nothing is saved until you check the preview and press Import.
        </p>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => onFile(e.target.files?.[0])} aria-label="Excel file" />
        {sheets && (
          <div className="fields">
            <Field label="File layout">
              <select value={format} onChange={(e) => setFormat(e.target.value as Format)}>
                <option value="weekly">Weekly stock report (items with dated count columns)</option>
                <option value="list">Simple list (one row per item, choose columns)</option>
              </select>
            </Field>
            {format === 'weekly' ? (
              <Field label="How counts line up with dates">
                <select value={alignment} onChange={(e) => setAlignment(e.target.value as Alignment)}>
                  <option value="aligned">Each count is under its date (first count column is opening stock)</option>
                  <option value="shiftLeft">Each count belongs to the date one column to its right</option>
                </select>
              </Field>
            ) : (
              <>
                <Field label="Sheet">
                  <select value={listSheet} onChange={(e) => setListSheet(Number(e.target.value))}>
                    {sheets.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}
                  </select>
                </Field>
                <Field label="Header row number">
                  <input type="number" min={1} value={headerRow + 1} onChange={(e) => setHeaderRow(Math.max(0, Number(e.target.value) - 1))} />
                </Field>
                {FIELDS.map(([key, label, required]) => (
                  <Field key={key} label={`${label}${required ? ' *' : ''} column`}>
                    <select value={map[key] ?? ''} onChange={(e) => setMap((m) => ({ ...m, [key]: e.target.value === '' ? undefined : Number(e.target.value) }))}>
                      <option value="">— none —</option>
                      {header.map((h, i) => <option key={i} value={i}>{String(h ?? `Column ${i + 1}`)}</option>)}
                    </select>
                  </Field>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {result && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <h2>Preview: {rows.length - skip.size} of {rows.length} items</h2>
            <span className="muted small">
              {fileName}
              {result.dates.length > 0 && ` · counts from ${fmtDate(result.dates[0])} to ${fmtDate(result.dates[result.dates.length - 1])}`}
            </span>
            <span className="spacer" />
            <button className="btn primary" onClick={save} disabled={rows.length === skip.size}>Import</button>
          </div>
          {result.warnings.map((w) => <p key={w} className="err">{w}</p>)}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Use</th>
                  <th>Name</th>
                  <th>Size</th>
                  <th>Category</th>
                  <th>Unit</th>
                  <th className="num">Stock</th>
                  <th className="num">Counts</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={skip.has(i) ? { opacity: 0.45 } : undefined}>
                    <td>
                      <input
                        type="checkbox"
                        style={{ width: 'auto' }}
                        checked={!skip.has(i)}
                        aria-label={`Import ${r.name} ${r.size}`}
                        onChange={() => setSkip((s) => {
                          const n = new Set(s);
                          if (n.has(i)) n.delete(i);
                          else n.add(i);
                          return n;
                        })}
                      />
                    </td>
                    <td>{r.name}{existing.has(`${r.name}|${r.size}`) && <div className="small muted">already exists: history merged</div>}</td>
                    <td>{r.size}</td>
                    <td>
                      <select value={r.category} onChange={(e) => edit(i, { category: e.target.value as Category })} aria-label="Category">
                        {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={r.unit} onChange={(e) => edit(i, { unit: e.target.value as Unit })} aria-label="Unit">
                        {UNITS.map((u) => <option key={u}>{u}</option>)}
                      </select>
                    </td>
                    <td className="num">{fmtQty(r.qty)}</td>
                    <td className="num">{r.counts.length}</td>
                    <td className="small muted">{r.warnings.join('; ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

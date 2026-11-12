import { useState } from 'react';
import { can, itemLabel, suggestStockItem, widthsOf, type SqmMaterial } from '@fca/core';
import { newId, useStore } from '../data/store';
import { t } from '../i18n';
import { Modal } from './ui';

/** Calculator materials: roll widths / sheet size, bleed, overlap, and the stock item each comes from. */
export function SqmMaterialsEditor({ onClose }: { onClose: () => void }) {
  const { data, me, dispatch, toast } = useStore();
  const editable = can(me?.role, 'items');
  const [mats, setMats] = useState<SqmMaterial[]>(() => data.sqmMaterials.map((m) => ({ ...m, widths: m.widths || String(m.width || ''), links: { ...m.links } })));
  const items = data.items.filter((i) => i.active);

  const patch = (id: string, p: Partial<SqmMaterial>) => setMats((ms) => ms.map((m) => (m.id === id ? { ...m, ...p } : m)));
  const keysOf = (m: SqmMaterial) => (m.kind === 'roll' ? widthsOf(m).map(String) : ['sheet']);

  const save = () => {
    const clean = mats.map((m) => {
      const keys = new Set(keysOf(m));
      const links = Object.fromEntries(Object.entries(m.links ?? {}).filter(([k, v]) => keys.has(k) && v));
      const first = widthsOf(m)[0] ?? 0;
      return { ...m, width: m.kind === 'roll' ? first : +m.width || 0, length: m.kind === 'roll' ? 0 : +m.length || 0, bleed: +m.bleed || 0, overlap: +(m.overlap ?? 2) || 0, links };
    });
    if (dispatch({ kind: 'saveSqmMaterials', id: newId(), materials: clean })) {
      toast('Materials saved');
      onClose();
    }
  };

  return (
    <Modal
      title="Materials"
      onClose={onClose}
      footer={
        editable ? (
          <>
            <button className="btn" onClick={() => setMats((ms) => [...ms, { id: `m${Date.now().toString(36)}`, name: '', kind: 'roll', widths: '', width: 0, length: 0, bleed: 3, overlap: 2, links: {} }])}>
              + Add material
            </button>
            <span className="spacer" />
            <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
            <button className="btn primary" onClick={save}>{t('common.save')}</button>
          </>
        ) : (
          <button className="btn" onClick={onClose}>{t('common.close')}</button>
        )
      }
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        For rolls stocked in several widths, list them all (e.g. 152, 127, 107). The width with the least wastage is used for each job. “From stock” is the stock item used
        when you press Take from stock; “Auto” picks the matching item by name and width.
        {!editable && ' Only Managers, Bosses and the Admin can change materials.'}
      </p>
      <div className="stack">
        {mats.map((m) => (
          <fieldset className="sqm-mat" key={m.id} disabled={!editable}>
            <div className="fields">
              <label className="field full">
                <span>Material</span>
                <input value={m.name} onChange={(e) => patch(m.id, { name: e.target.value })} maxLength={80} />
              </label>
              <label className="field">
                <span>Type</span>
                <select value={m.kind} onChange={(e) => patch(m.id, { kind: e.target.value as 'roll' | 'sheet', links: {} })}>
                  <option value="roll">Roll</option>
                  <option value="sheet">Sheet</option>
                </select>
              </label>
              {m.kind === 'roll' ? (
                <label className="field">
                  <span>Roll widths (cm)</span>
                  <input value={m.widths ?? ''} onChange={(e) => patch(m.id, { widths: e.target.value })} placeholder="e.g. 152, 127" />
                </label>
              ) : (
                <label className="field">
                  <span>Sheet size (cm)</span>
                  <span className="row" style={{ flexWrap: 'nowrap' }}>
                    <input type="number" min="0" value={m.width || ''} onChange={(e) => patch(m.id, { width: +e.target.value })} aria-label="Sheet width" />
                    ×
                    <input type="number" min="0" value={m.length || ''} onChange={(e) => patch(m.id, { length: +e.target.value })} aria-label="Sheet length" />
                  </span>
                </label>
              )}
              <label className="field">
                <span>Bleed cm / side</span>
                <input type="number" min="0" step="0.5" value={m.bleed} onChange={(e) => patch(m.id, { bleed: +e.target.value })} />
              </label>
              {m.kind === 'roll' && (
                <label className="field">
                  <span>Panel overlap cm</span>
                  <input type="number" min="0" step="0.5" value={m.overlap ?? 2} onChange={(e) => patch(m.id, { overlap: +e.target.value })} />
                </label>
              )}
              {keysOf(m).map((k) => {
                const auto = suggestStockItem(m, k === 'sheet' ? null : +k, items);
                const unit = m.kind === 'roll' ? 'Rolls' : 'Sheets';
                return (
                  <label className="field full" key={k}>
                    <span>From stock{k !== 'sheet' ? ` (${+k / 100} m roll)` : ''}</span>
                    <select value={m.links?.[k] ?? ''} onChange={(e) => patch(m.id, { links: { ...m.links, [k]: e.target.value } })}>
                      <option value="">Auto: {auto ? itemLabel(auto) : 'not stocked'}</option>
                      {items.filter((i) => i.unit === unit).map((i) => <option key={i.id} value={i.id}>{itemLabel(i)}</option>)}
                    </select>
                  </label>
                );
              })}
            </div>
            {editable && (
              <button className="btn small ghost danger" onClick={() => setMats((ms) => ms.filter((x) => x.id !== m.id))}>
                Remove {m.name || 'material'}
              </button>
            )}
          </fieldset>
        ))}
      </div>
    </Modal>
  );
}

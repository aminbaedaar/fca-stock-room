import { useState } from 'react';
import { CATEGORIES, UNITS, type Category, type Item, type Unit } from '@fca/core';
import { newId, useStore } from '../data/store';
import { t } from '../i18n';
import { Field, Modal } from './ui';

export function ItemEditor({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const { dispatch, toast } = useStore();
  const [name, setName] = useState(item?.name ?? '');
  const [size, setSize] = useState(item?.size ?? '');
  const [category, setCategory] = useState<Category>(item?.category ?? 'Print Media');
  const [unit, setUnit] = useState<Unit>(item?.unit ?? 'Rolls');
  const [min, setMin] = useState(String(item?.min_level ?? 0));
  const [qty, setQty] = useState('0');
  const [note, setNote] = useState(item?.note ?? '');

  const submit = () => {
    if (!name.trim()) return toast('Item name is required.', 'error');
    const ok = dispatch({
      kind: 'saveItem',
      id: newId(),
      item_id: item?.id ?? null,
      fields: { name, size, category, unit, min_level: Number(min) || 0, note },
      qty: item ? item.qty : Number(qty) || 0,
    });
    if (ok) {
      toast(item ? 'Item updated' : 'Item added');
      onClose();
    }
  };

  return (
    <Modal
      title={item ? t('common.edit') : t('stock.add')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" onClick={submit}>{t('common.save')}</button>
        </>
      }
    >
      <form className="fields" onSubmit={(e) => (e.preventDefault(), submit())}>
        <Field label="Name" full>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="e.g. GLOSSY STICKER" />
        </Field>
        <Field label={t('common.size')}>
          <input value={size} onChange={(e) => setSize(e.target.value)} maxLength={40} placeholder="e.g. 1.27X50M, 3MM, A2" />
        </Field>
        <Field label={t('common.category')}>
          <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label={t('common.unit')}>
          <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
            {UNITS.map((u) => <option key={u}>{u}</option>)}
          </select>
        </Field>
        <Field label={t('common.minimum')}>
          <input type="number" inputMode="decimal" min="0" step="any" value={min} onChange={(e) => setMin(e.target.value)} />
        </Field>
        {!item && (
          <Field label="Starting stock">
            <input type="number" inputMode="decimal" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
        )}
        <Field label={t('common.note')} full>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Field>
        {unit === 'Rolls' && <p className="full muted small" style={{ margin: 0 }}>For rolls, write the size as WIDTH X LENGTH, e.g. 1.27X50M, so stock out can be entered in metres.</p>}
        {category === 'Ink & Solvent' && <p className="full muted small" style={{ margin: 0 }}>For ink, put the machine in the name (e.g. SK-7 INK) and the colour in the size (e.g. CYAN).</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

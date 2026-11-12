import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SQM_MATERIALS, materialFor, parseItemsText } from '../src/index.ts';

// Answers recorded from the standalone SQM & Wastage Calculator's quick add.
const fx = JSON.parse(readFileSync(new URL('./fixtures/sqm-quickadd.json', import.meta.url), 'utf8'));

describe('quick add reads lines like the standalone calculator', () => {
  fx.lines.forEach((line: string, i: number) => {
    it(line, () => {
      const got = parseItemsText(line, DEFAULT_SQM_MATERIALS)[0] ?? null;
      const norm = (o: Record<string, unknown> | null) => (o ? { ...o, mat: o.mat ?? null } : o);
      expect(norm(got as unknown as Record<string, unknown>)).toEqual(norm(fx.out[i]));
    });
  });
  it('a new material copies the widest material of its type', () => {
    const { mat, isNew } = materialFor('Frosty Sticker', DEFAULT_SQM_MATERIALS, () => 'new1');
    expect(isNew).toBe(true);
    expect(mat).toMatchObject({ id: 'new1', name: 'Frosty Sticker', kind: 'roll', width: 152 });
    expect(materialFor('glossy sticker', DEFAULT_SQM_MATERIALS, () => 'x').isNew).toBe(false);
  });
});

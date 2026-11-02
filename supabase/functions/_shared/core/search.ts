import type { Item } from './types.ts';

function norm(s: string): string {
  return s.toLowerCase().replace(/[×]/g, 'x').replace(/\s+/g, ' ').trim();
}

/** "glossy 1.27" matches "GLOSSY STICKER 1.27X50M": every word must appear. */
export function matchesSearch(item: Pick<Item, 'name' | 'size' | 'category' | 'note'>, query: string): boolean {
  const q = norm(query);
  if (!q) return true;
  const hay = norm(`${item.name} ${item.size} ${item.category} ${item.note}`);
  return q.split(' ').every((w) => hay.includes(w));
}

export function itemLabel(item: Pick<Item, 'name' | 'size'>): string {
  return item.size ? `${item.name} ${item.size}` : item.name;
}

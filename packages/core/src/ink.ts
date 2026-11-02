import type { Item } from './types.ts';

// Ink items are recognised by name: the item name contains the machine,
// and the colour is in the size (or name), e.g. name "SK-7 INK", size "CYAN".
export const MACHINES = [
  { id: 'SK-1', label: 'SK-1', match: /\bSK-?\s?1\b/i },
  { id: 'SK-7', label: 'SK-7', match: /\bSK-?\s?7\b/i },
  { id: 'R8', label: 'UV Flatbed R8', match: /FLAT\s*-?BED|\bR8\b/i },
  { id: 'S6', label: 'UV Roll To Roll S6', match: /ROLL\s*TO\s*ROLL|\bS6\b/i },
  { id: 'WIT', label: 'WIT Color', match: /\bWIT\b/i },
] as const;

export type MachineId = (typeof MACHINES)[number]['id'];

export const INK_COLOURS = ['cyan', 'magenta', 'yellow', 'black', 'white'] as const;
export type InkColour = (typeof INK_COLOURS)[number];

export function machineOf(name: string): MachineId | null {
  return MACHINES.find((m) => m.match.test(name))?.id ?? null;
}

export function colourOf(item: Pick<Item, 'name' | 'size'>): InkColour | null {
  const text = `${item.size} ${item.name}`.toLowerCase();
  return INK_COLOURS.find((c) => new RegExp(`\\b${c}\\b`).test(text)) ?? null;
}

export function inkByMachine<T extends Item>(items: T[]) {
  return MACHINES.map((m) => ({
    machine: m,
    items: items
      .filter((i) => i.active && i.category === 'Ink & Solvent' && machineOf(i.name) === m.id)
      .sort((a, b) => colourRank(a) - colourRank(b) || a.sort - b.sort),
  })).filter((g) => g.items.length > 0);
}

function colourRank(i: Item): number {
  const c = colourOf(i);
  return c ? INK_COLOURS.indexOf(c) : 99;
}

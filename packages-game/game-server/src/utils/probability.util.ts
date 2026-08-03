export function checkProbability(rate: number): boolean {
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  return Math.random() < rate;
}

export interface DropRollItem<T = string> {
  item: T;
  dropRate: number;
  weight?: number;
  minQty?: number;
  maxQty?: number;
}

export function rollDrop<T>(
  items: DropRollItem<T>[],
  baseRate: number,
  maxDrops: number,
): { item: T; quantity: number }[] {
  if (!checkProbability(baseRate)) return [];
  const results: { item: T; quantity: number }[] = [];
  const weighted = items.map((i) => ({ ...i, weight: i.weight ?? 1 }));
  for (let i = 0; i < maxDrops && weighted.length > 0; i++) {
    const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
    let random = Math.random() * totalWeight;
    let selectedIndex = 0;
    for (let j = 0; j < weighted.length; j++) {
      random -= weighted[j].weight;
      if (random <= 0) {
        selectedIndex = j;
        break;
      }
    }
    const selected = weighted.splice(selectedIndex, 1)[0];
    const qty =
      (selected.minQty ?? 1) +
      Math.floor(
        Math.random() * ((selected.maxQty ?? 1) - (selected.minQty ?? 1) + 1),
      );
    if (qty > 0) results.push({ item: selected.item, quantity: qty });
  }
  return results;
}

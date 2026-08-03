function toLocalDateStr(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getTodayStr(): string {
  return toLocalDateStr(new Date());
}

export function getYesterdayStr(): string {
  return toLocalDateStr(new Date(Date.now() - 86400000));
}

export function getWeekRange(): { start: string; end: string } {
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - day + 1);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    start: toLocalDateStr(monday),
    end: toLocalDateStr(sunday),
  };
}

export function isSameDay(d1: Date, d2: Date): boolean {
  return toLocalDateStr(d1) === toLocalDateStr(d2);
}

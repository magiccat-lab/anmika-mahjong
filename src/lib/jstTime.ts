// [2026-10-27 リョー「オンミカの時間が日本時間になってない」] DB の datetime('now') は UTC の
// "YYYY-MM-DD HH:MM:SS"。画面に出す時だけ JST [+9h] に直す。形が違う値はそのまま返す
export function utcToJst(utc: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(utc ?? '');
  if (!m) return utc ?? '';
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)) + 9 * 3600_000;
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

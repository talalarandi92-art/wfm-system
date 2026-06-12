/**
 * Shared formatting utilities — used across all pages.
 * Always pass `ar` (boolean) so formatters respect the current UI language.
 *
 * Time:     12-hour with AM/PM  →  "6:45 PM"  /  "6:45 م"
 * Duration: hours + minutes     →  "2h 30m"   /  "2س 30د"
 * Date:     Latin numerals always (avoids font-missing Arabic-Indic glyphs)
 */

const NUM_LOCALE = 'en-u-nu-latn'; // forces Latin (0-9) numerals everywhere

// ── Date ─────────────────────────────────────────────────────────────────────

/** Short date: "12/06/2026" — always Latin numerals */
export function fmtDate(d?: string | null, _ar?: boolean): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString(NUM_LOCALE, {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

/** Short date without year: "12/06" */
export function fmtDateShort(d?: string | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString(NUM_LOCALE, { day: '2-digit', month: '2-digit' });
}

/** Full readable date: "Thursday, 12 June 2026" / "الخميس، 12 يونيو 2026" */
export function fmtDateFull(d?: string | null, ar?: boolean): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '—';
  // Use Latin numerals even in Arabic to avoid font issues
  const locale = ar ? 'ar-KW-u-nu-latn' : 'en-GB-u-nu-latn';
  return dt.toLocaleDateString(locale, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

// ── Time ─────────────────────────────────────────────────────────────────────

/**
 * Convert a "HH:MM" or "HH:MM:SS" time string to 12-hour format.
 * Arabic:  "6:45 م"  (م = PM, ص = AM)
 * English: "6:45 PM"
 */
export function fmtTime(t?: string | null, ar?: boolean): string {
  if (!t) return '—';
  // Accept "HH:MM" or "HH:MM:SS"
  const parts = t.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1] ?? '0', 10);
  if (isNaN(h) || isNaN(m)) return t;

  const isPm = h >= 12;
  const h12  = h % 12 === 0 ? 12 : h % 12;
  const mm   = m.toString().padStart(2, '0');
  if (ar) {
    const ampm = isPm ? 'م' : 'ص';
    return `${h12}:${mm} ${ampm}`;
  }
  return `${h12}:${mm} ${isPm ? 'PM' : 'AM'}`;
}

/**
 * Format a full ISO datetime string to 12-hour time.
 * "2026-06-12T18:45:00Z" → "6:45 PM" / "6:45 م"
 */
export function fmtDateTimeTime(dt?: string | null, ar?: boolean): string {
  if (!dt) return '—';
  const d = new Date(dt);
  if (isNaN(d.getTime())) return '—';
  const h   = d.getHours();
  const m   = d.getMinutes();
  const isPm = h >= 12;
  const h12  = h % 12 === 0 ? 12 : h % 12;
  const mm   = m.toString().padStart(2, '0');
  if (ar) return `${h12}:${mm} ${isPm ? 'م' : 'ص'}`;
  return `${h12}:${mm} ${isPm ? 'PM' : 'AM'}`;
}

/**
 * Full date + 12-hour time.
 * "12/06/2026 · 6:45 PM"
 */
export function fmtDateTime(dt?: string | null, ar?: boolean): string {
  if (!dt) return '—';
  const d = new Date(dt);
  if (isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString(NUM_LOCALE, {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
  return `${date} · ${fmtDateTimeTime(dt, ar)}`;
}

// ── Duration ─────────────────────────────────────────────────────────────────

/**
 * Convert minutes to "Xh Ym" — never shows just minutes.
 * Arabic:  "2س 30د"
 * English: "2h 30m"
 * Zero:    "—"
 */
export function fmtDuration(minutes?: number | null, ar?: boolean): string {
  if (minutes == null || minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (ar) {
    if (h === 0) return `${m}د`;
    if (m === 0) return `${h}س`;
    return `${h}س ${m}د`;
  }
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Convert seconds to "Xh Ym Zs" — used for adherence / live timers.
 */
export function fmtDurationSec(seconds?: number | null, ar?: boolean): string {
  if (seconds == null || seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (ar) {
    if (h > 0) return `${h}س ${m}د ${s}ث`;
    if (m > 0) return `${m}د ${s}ث`;
    return `${s}ث`;
  }
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Duration as a long readable label.
 * Arabic:  "ساعتان و 30 دقيقة"
 * English: "2 hours 30 minutes"
 */
export function fmtDurationLong(minutes?: number | null, ar?: boolean): string {
  if (minutes == null || minutes <= 0) return ar ? 'لا يوجد' : 'None';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (ar) {
    const hPart = h > 0 ? `${h} ساعة` : '';
    const mPart = m > 0 ? `${m} دقيقة` : '';
    return [hPart, mPart].filter(Boolean).join(' و ');
  }
  const hPart = h > 0 ? `${h}h` : '';
  const mPart = m > 0 ? `${m}m` : '';
  return [hPart, mPart].filter(Boolean).join(' ') || '—';
}

// ── Encoding fix ──────────────────────────────────────────────────────────────

/**
 * Windows-1252 reverse mapping for the 0x80–0x9F range.
 * These code points differ from their Latin-1 equivalents.
 * Key = Unicode codepoint as stored in JS string, Value = original byte value.
 */
const W1252_REVERSE: Record<number, number> = {
  0x20AC: 0x80, // €
  0x201A: 0x82, // ‚
  0x0192: 0x83, // ƒ
  0x201E: 0x84, // „  ← ل، م، ن، و، ى go through this range
  0x2026: 0x85, // …
  0x2020: 0x86, // †
  0x2021: 0x87, // ‡
  0x02C6: 0x88, // ˆ
  0x2030: 0x89, // ‰
  0x0160: 0x8A, // Š
  0x2039: 0x8B, // ‹
  0x0152: 0x8C, // Œ
  0x017D: 0x8E, // Ž
  0x2018: 0x91, // '
  0x2019: 0x92, // '
  0x201C: 0x93, // "
  0x201D: 0x94, // "
  0x2022: 0x95, // •
  0x2013: 0x96, // –
  0x2014: 0x97, // —
  0x02DC: 0x98, // ˜
  0x2122: 0x99, // ™
  0x0161: 0x9A, // š
  0x203A: 0x9B, // ›
  0x0153: 0x9C, // œ
  0x017E: 0x9E, // ž
  0x0178: 0x9F, // Ÿ
};

function toW1252Byte(c: string): number {
  const code = c.charCodeAt(0);
  if (code <= 0xFF) return code;           // Latin-1 range — direct
  return W1252_REVERSE[code] ?? code & 0xFF; // W1252 special chars
}

/**
 * Fix double-encoded Arabic text (Mojibake from Windows-1252 / Latin-1).
 *
 * When UTF-8 Arabic was read as Windows-1252 bytes, each 2-byte Arabic char
 * became 2 Latin/special chars.  e.g. "ص" (0xD8 0xB5) → "Øµ",
 *                                      "ل" (0xD9 0x84) → "Ù„"
 *
 * We detect the pattern (Ø/Ù/Ú/Û leading chars typical of Arabic UTF-8
 * first-bytes) then reverse the W1252 encoding and re-decode as UTF-8.
 */
export function fixEncoding(s?: string | null): string {
  if (!s) return s ?? '';
  // Arabic UTF-8 first bytes (0xD8–0xDB) map to Ø Ù Ú Û in W1252
  if (!/[ØÙÚÛ]/.test(s)) return s;
  try {
    const bytes = new Uint8Array([...s].map(toW1252Byte));
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    // Only accept if result contains actual Arabic
    if (/[؀-ۿ]/.test(decoded)) return decoded;
  } catch {}
  return s;
}

const M = 2176782336n;
const A = 1234567n;
const C = 890123n;
const A_INV = 2128248631n;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const BASE = BigInt(ALPHABET.length);

export function encodeRoomId(id: number): string {
  const idBig = BigInt(id);
  const encodedNum = (idBig * A + C) % M;
  
  let num = encodedNum;
  let str = '';
  for (let i = 0; i < 6; i++) {
    str = ALPHABET[Number(num % BASE)] + str;
    num = num / BASE;
  }
  return str;
}

/** Accepts raw user input: numeric id, or 6-character encoded code (optional # / spaces). */
export function parseRoomNumberOrCode(raw: string): number | null {
  const s = raw
    .trim()
    .replace(/^#+/i, "")
    .replace(/^room\s*#?\s*/i, "")
    .replace(/\s/g, "");
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (s.length === 6) return decodeRoomId(s.toUpperCase());
  return null;
}

/** Share / deep link path, e.g. `/room/A65NE5`. */
export function roomPath(roomId: number): string {
  return `/room/${encodeRoomId(roomId)}`;
}

/** granite.config `appName` 과 동일해야 앱인토스 딥링크가 열립니다. */
export const TOSS_INTOSS_APP_NAME = "puzzlox";

/** 앱인토스 초대·공유용 URL (`intoss://앱이름/room/숫자방ID`). */
export function tossIntossRoomUrl(roomId: number): string {
  return `intoss://${TOSS_INTOSS_APP_NAME}/room/${roomId}`;
}

/** 앱인토스 프로필 딥링크 (`intoss://앱이름/u/아이디`). 경로 세그먼트는 RFC 3986에 맞게 인코딩합니다. */
export function tossIntossProfileUrl(username: string): string {
  const seg = encodeURIComponent(String(username).trim());
  return `intoss://${TOSS_INTOSS_APP_NAME}/u/${seg}`;
}

/** Reads encoded id or numeric id from pathname `/room/<code>`. */
export function parseRoomCodeFromPathname(pathname: string): string | null {
  const m = pathname.trim().match(/^\/room\/([^/]+)\/?$/i);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]).trim();
  } catch {
    return m[1].trim();
  }
}

/** Legacy `/?room=CODE` → `/room/CODE` (keeps other query params). */
export function canonicalizeRoomUrlToPath(): void {
  const pathCode = parseRoomCodeFromPathname(window.location.pathname);
  const u = new URL(window.location.href);
  const q = u.searchParams.get('room')?.trim();
  if (!q || pathCode) return;
  u.searchParams.delete('room');
  const tail = u.searchParams.toString();
  u.pathname = `/room/${encodeURIComponent(q)}`;
  u.search = tail ? `?${tail}` : '';
  window.history.replaceState({}, '', `${u.pathname}${u.search}${u.hash}`);
}

export function roomCodeFromLocation(): string | null {
  canonicalizeRoomUrlToPath();
  return (
    parseRoomCodeFromPathname(window.location.pathname) ??
    new URLSearchParams(window.location.search).get('room')?.trim() ??
    null
  );
}

export function decodeRoomId(code: string): number | null {
  if (!code || code.length !== 6) return null;
  
  let num = 0n;
  for (let i = 0; i < 6; i++) {
    const charIndex = ALPHABET.indexOf(code[i].toUpperCase());
    if (charIndex === -1) return null;
    num = num * BASE + BigInt(charIndex);
  }
  
  let idBig = ((num - C) * A_INV) % M;
  if (idBig < 0n) idBig += M;
  
  return Number(idBig);
}

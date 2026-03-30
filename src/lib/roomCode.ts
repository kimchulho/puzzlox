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

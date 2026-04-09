export function fpShort(fp) {
  const s = String(fp || '');
  return s.length <= 18 ? s : `${s.slice(0, 8)}...${s.slice(-6)}`;
}

const leet: Record<string, string> = { '0': 'o', '1': 'i', '2': 'z', '3': 'e', '4': 'a', '5': 's', '6': 'g', '7': 't', '8': 'b', '9': 'g', '@': 'a', '$': 's' };
const confusables: Record<string, string> = {
  'а': 'a', 'е': 'e', 'і': 'i', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x',
  'ɑ': 'a', 'ο': 'o', 'ν': 'v', 'ѕ': 's', 'ӏ': 'l',
};

export function normalizeForModeration(input: string): string {
  const canonical = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '')
    .toLowerCase()
    .split('')
    .map((char) => confusables[char] ?? leet[char] ?? char)
    .join('');
  return canonical.replace(/(.)\1{3,}/g, '$1$1$1').replace(/[^a-z0-9:/._?&=#+\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function collapsed(input: string): string {
  return normalizeForModeration(input).replace(/[^a-z0-9]/g, '');
}

export function containsNormalizedTerm(normalized: string, term: string): boolean {
  const normalizedTerm = normalizeForModeration(term);
  if (normalizedTerm.includes(' ')) return normalized.includes(normalizedTerm);
  const boundary = new RegExp(`(^|[^a-z0-9])${escapeRegex(normalizedTerm)}([^a-z0-9]|$)`, 'i');
  if (boundary.test(normalized)) return true;
  const compactTerm = collapsed(normalizedTerm);
  if (compactTerm.length >= 4) return collapsed(normalized).includes(compactTerm);
  return false;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface MatchResult {
  fullMatch: string;
  index: number;
  groups: string[];
  namedGroups: Record<string, string>;
}

export interface RegexResult {
  isValid: boolean;
  error?: string;
  matches: MatchResult[];
  matchCount: number;
}

export function safeCreateRegex(pattern: string, flags: string): RegExp | null {
  try { return new RegExp(pattern, flags); } catch { return null; }
}

export function validateRegex(pattern: string, flags: string): { valid: boolean; error?: string } {
  try { new RegExp(pattern, flags); return { valid: true }; }
  catch (e) { return { valid: false, error: (e as Error).message }; }
}

export function extractMatches(pattern: string, flags: string, testString: string): RegexResult {
  const validation = validateRegex(pattern, flags);
  if (!validation.valid) return { isValid: false, error: validation.error, matches: [], matchCount: 0 };
  if (!pattern) return { isValid: true, matches: [], matchCount: 0 };
  const regex = new RegExp(pattern, flags);
  const matches: MatchResult[] = [];
  if (flags.includes('g')) {
    let match: RegExpExecArray | null;
    let safety = 0;
    while ((match = regex.exec(testString)) !== null && safety < 1000) {
      safety++;
      matches.push({ fullMatch: match[0], index: match.index, groups: match.slice(1), namedGroups: match.groups ? { ...match.groups } : {} });
      if (match[0].length === 0) regex.lastIndex++;
    }
  } else {
    const match = regex.exec(testString);
    if (match) matches.push({ fullMatch: match[0], index: match.index, groups: match.slice(1), namedGroups: match.groups ? { ...match.groups } : {} });
  }
  return { isValid: true, matches, matchCount: matches.length };
}

// Разбор паттерна живёт в отдельном модуле — он большой и требует сверки с
// поведением настоящего движка. Здесь только реэкспорт, чтобы не ломать импорты.
export type { ExplanationPart, SetItem, Quantifier, PartKind, CharClassLetter } from './regex-explain';
export { explainPattern, readQuantifier, scanGroups } from './regex-explain';

export interface CheatSheetItem { token: string; description: string }
export interface CheatSheetCategory { category: string; items: CheatSheetItem[] }

/**
 * Шпаргалка. Формулировки намеренно совпадают с теми, что выдаёт explainPattern:
 * если панель объяснения и шпаргалка описывают \b по-разному, одна из них врёт.
 */
export const CHEAT_SHEET: CheatSheetCategory[] = [
  {
    category: 'Anchors',
    items: [
      { token: '^', description: 'Start of the string (start of a line with the m flag)' },
      { token: '$', description: 'End of the string (end of a line with the m flag)' },
      { token: '\\b', description: 'Word boundary (zero-width)' },
      { token: '\\B', description: 'Not a word boundary' },
    ],
  },
  {
    category: 'Character classes',
    items: [
      { token: '.', description: 'Any character except a line break (s flag includes them)' },
      { token: '\\d', description: 'Digit 0-9' },
      { token: '\\D', description: 'Not a digit' },
      { token: '\\w', description: 'Word character: A-Z a-z 0-9 _' },
      { token: '\\W', description: 'Not a word character' },
      { token: '\\s', description: 'Whitespace' },
      { token: '\\S', description: 'Not whitespace' },
    ],
  },
  {
    category: 'Sets',
    items: [
      { token: '[abc]', description: 'One character out of a, b or c' },
      { token: '[^abc]', description: 'One character that is none of a, b, c' },
      { token: '[a-z]', description: 'One character in the range a to z' },
      { token: '[\\b]', description: 'Backspace U+0008 — inside a set \\b is NOT a word boundary' },
    ],
  },
  {
    category: 'Quantifiers',
    items: [
      { token: '*', description: 'Zero or more times' },
      { token: '+', description: 'One or more times' },
      { token: '?', description: 'Optional: zero or one time' },
      { token: '{3}', description: 'Exactly 3 times' },
      { token: '{3,}', description: '3 or more times' },
      { token: '{2,4}', description: '2 to 4 times' },
      { token: '+?', description: 'Same counts, but prefers the shortest match (lazy)' },
    ],
  },
  {
    category: 'Groups',
    items: [
      { token: '(...)', description: 'Capturing group — the match is saved' },
      { token: '(?:...)', description: 'Non-capturing group — grouping only' },
      { token: '(?<name>...)', description: 'Named capturing group' },
      { token: '|', description: 'Alternation — the left side or the right side' },
      { token: '\\1', description: 'Backreference to what group 1 captured' },
      { token: '\\k<name>', description: 'Backreference to a named group' },
    ],
  },
  {
    category: 'Lookaround',
    items: [
      { token: '(?=...)', description: 'Lookahead — must follow, not consumed' },
      { token: '(?!...)', description: 'Negative lookahead — must not follow' },
      { token: '(?<=...)', description: 'Lookbehind — must precede, not consumed' },
      { token: '(?<!...)', description: 'Negative lookbehind — must not precede' },
    ],
  },
  {
    category: 'Escapes',
    items: [
      { token: '\\.', description: 'A literal dot; same for \\* \\+ \\? \\( \\[ \\\\' },
      { token: '\\n', description: 'Line feed; also \\r \\t \\f \\v \\0' },
      { token: '\\x41', description: 'Character by two-digit hex code' },
      { token: '\\u0041', description: 'Character by four-digit hex code' },
      { token: '\\p{L}', description: 'Unicode property — needs the u flag' },
    ],
  },
  {
    category: 'Flags',
    items: [
      { token: 'g', description: 'Global — find every match, not just the first' },
      { token: 'i', description: 'Case-insensitive' },
      { token: 'm', description: 'Multiline — ^ and $ match at line breaks' },
      { token: 's', description: 'Dot matches line breaks too' },
      { token: 'u', description: 'Unicode mode — enables \\p{...} and \\u{...}' },
    ],
  },
];

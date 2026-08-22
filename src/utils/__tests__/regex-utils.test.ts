import { describe, it, expect } from 'vitest';
import { validateRegex, extractMatches, explainPattern, safeCreateRegex, CHEAT_SHEET } from '../regex-utils';

describe('validateRegex', () => {
  it('valid pattern', () => { expect(validateRegex('[a-z]+', 'g').valid).toBe(true); });
  it('invalid pattern', () => { const r = validateRegex('[', ''); expect(r.valid).toBe(false); expect(r.error).toBeTruthy(); });
  it('empty pattern is valid', () => { expect(validateRegex('', '').valid).toBe(true); });
});

describe('safeCreateRegex', () => {
  it('returns regex for valid', () => { expect(safeCreateRegex('abc', 'g')).toBeInstanceOf(RegExp); });
  it('returns null for invalid', () => { expect(safeCreateRegex('[', '')).toBeNull(); });
});

describe('extractMatches', () => {
  it('finds global matches', () => {
    const r = extractMatches('[0-9]+', 'g', 'abc 123 def 456');
    expect(r.isValid).toBe(true);
    expect(r.matchCount).toBe(2);
    expect(r.matches[0].fullMatch).toBe('123');
    expect(r.matches[1].fullMatch).toBe('456');
  });
  it('finds single match without g', () => {
    const r = extractMatches('[0-9]+', '', 'abc 123 def 456');
    expect(r.matchCount).toBe(1);
    expect(r.matches[0].fullMatch).toBe('123');
  });
  it('returns empty for no match', () => {
    const r = extractMatches('xyz', 'g', 'abc def');
    expect(r.matchCount).toBe(0);
  });
  it('handles groups', () => {
    const r = extractMatches('(a)(b)', '', 'ab');
    expect(r.matches[0].groups).toEqual(['a', 'b']);
  });
  it('handles invalid pattern', () => {
    const r = extractMatches('[', '', 'test');
    expect(r.isValid).toBe(false);
  });
  it('empty pattern returns empty matches', () => {
    const r = extractMatches('', 'g', 'test');
    expect(r.isValid).toBe(true);
    expect(r.matchCount).toBe(0);
  });
  it('reports correct index', () => {
    const r = extractMatches('def', '', 'abc def ghi');
    expect(r.matches[0].index).toBe(4);
  });
  it('case insensitive flag works', () => {
    const r = extractMatches('abc', 'gi', 'ABC abc AbC');
    expect(r.matchCount).toBe(3);
  });
});

describe('explainPattern', () => {
  it('explains caret', () => {
    const parts = explainPattern('^');
    expect(parts[0].token).toBe('^');
    expect(parts[0].description).toContain('Start');
  });
  it('explains literal chars', () => {
    // Раньше здесь ожидались три отдельных куска. Подряд идущий текст теперь
    // склеивается в один — читать «Literal text "abc"» проще, чем три чипа
    // подряд, и это по-прежнему правда. Подробный разбор — в regex-explain.test.ts.
    const parts = explainPattern('abc');
    expect(parts).toHaveLength(1);
    expect(parts[0].token).toBe('abc');
    expect(parts[0].description).toMatch(/literal text "abc"/);
  });
});

describe('CHEAT_SHEET', () => {
  it('has categories', () => { expect(CHEAT_SHEET.length).toBeGreaterThan(0); });
  it('each category has items', () => { CHEAT_SHEET.forEach(c => { expect(c.category).toBeTruthy(); expect(c.items.length).toBeGreaterThan(0); }); });
});

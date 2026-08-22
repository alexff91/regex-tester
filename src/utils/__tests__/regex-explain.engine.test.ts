import { describe, it, expect } from 'vitest';
import { explainPattern } from '../regex-utils';
import type { ExplanationPart, SetItem } from '../regex-utils';

/**
 * НЕЗАВИСИМАЯ проверка объяснений.
 *
 * Файл рядом (regex-explain.test.ts) сверяет подписи с тем, что я считаю
 * правильным, — то есть с собственным представлением. Этого мало: если я
 * ошибся в понимании синтаксиса, оба разбора ошибутся одинаково и тест
 * промолчит.
 *
 * Здесь эталон другой — сам движок RegExp. Разбор выдаёт машинночитаемые поля
 * (charSet.items, quantifier.min/max), и по ним проверяется НАСТОЯЩЕЕ поведение
 * new RegExp: какие символы реально попадают в набор, при скольких повторах
 * реально есть совпадение, сколько на самом деле захватывающих групп.
 * Определения \d, \w и \s ниже выписаны из спецификации руками и намеренно не
 * импортируются из разбора — иначе проверка снова стала бы круговой.
 */

/* --- определения классов, выписанные из спецификации ---------------- */

const isDigit = (cp: number): boolean => cp >= 0x30 && cp <= 0x39;

const isWord = (cp: number): boolean =>
  isDigit(cp) ||
  (cp >= 0x41 && cp <= 0x5a) ||
  (cp >= 0x61 && cp <= 0x7a) ||
  cp === 0x5f;

// WhiteSpace + LineTerminator из ECMA-262.
const SPACE_POINTS = new Set([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
]);
const isSpace = (cp: number): boolean => SPACE_POINTS.has(cp) || (cp >= 0x2000 && cp <= 0x200a);

const CLASS_PREDICATE: Record<string, (cp: number) => boolean> = {
  d: isDigit,
  D: (cp) => !isDigit(cp),
  w: isWord,
  W: (cp) => !isWord(cp),
  s: isSpace,
  S: (cp) => !isSpace(cp),
};

/** Попадает ли код символа в разобранный набор — считается по items, не по коду разбора. */
function itemContains(item: SetItem, cp: number): boolean {
  if (item.kind === 'char') return (item.ch.codePointAt(0) ?? -1) === cp;
  if (item.kind === 'range') {
    return cp >= (item.from.codePointAt(0) ?? 0) && cp <= (item.to.codePointAt(0) ?? 0);
  }
  return CLASS_PREDICATE[item.cls](cp);
}

function setContains(set: { negated: boolean; items: SetItem[] }, cp: number): boolean {
  const inside = set.items.some((item) => itemContains(item, cp));
  return set.negated ? !inside : inside;
}

/* --- реальные выражения для проверки -------------------------------- */

const REAL_PATTERNS: string[] = [
  '\\d{3}-\\d{2}-\\d{4}',
  '^[\\w.+-]+@[\\w-]+\\.[a-z]{2,}$',
  '^(?:https?|ftp)://[^\\s/$.?#].[^\\s]*$',
  '^(\\d{4})-(\\d{2})-(\\d{2})$',
  '(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})',
  '^#?([a-f0-9]{6}|[a-f0-9]{3})$',
  '\\b\\w+\\b',
  '^\\s*$',
  '(\\w)\\1',
  '^(?=.*[A-Z])(?=.*\\d)[A-Za-z\\d]{8,}$',
  '\\((\\d{3})\\)\\s?\\d{3}-\\d{4}',
  '^[+-]?\\d+(\\.\\d+)?$',
  'colou?r',
  '<([a-z]+)[^>]*>.*?</\\1>',
  '[^aeiou]+',
  'a{2,}b*c?',
  '(?:ab)+',
  '(?!foo)\\w+',
  '(?<=\\$)\\d+(?:\\.\\d{2})?',
  '(?<!\\d),',
  'foo|bar|baz',
  '^\\t+',
  '[\\d\\s.-]{5,20}',
  '\\x41\\x42',
  '\\u00e9',
  '[A-Za-z0-9_-]{21}',
  '^\\/api\\/v\\d+\\/',
  '\\bERROR\\b.*$',
  '(a|b)(c|d)',
  '\\.{3,}',
  '[\\[\\]{}()]',
  '^-?\\d+(?:,\\d{3})*$',
];

const compiles = (src: string, flags = ''): boolean => {
  try { new RegExp(src, flags); return true; } catch { return false; }
};

/* --- 1. Ничего не потеряно и не придумано --------------------------- */

describe('разбор ничего не теряет и не добавляет', () => {
  it('склейка токенов возвращает исходный паттерн', () => {
    for (const src of REAL_PATTERNS) {
      const joined = explainPattern(src).map((p) => p.token).join('');
      expect(joined, `паттерн ${src}`).toBe(src);
    }
  });

  it('то же самое на случайном мусоре: разбор не падает и не теряет символы', () => {
    // Детерминированный генератор — чтобы упавший тест можно было повторить.
    let seed = 20260822;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const alphabet = '\\dwsbBpk^$.*+?()[]{}|-<>=!:,0129azAZ_ ';

    for (let n = 0; n < 3000; n += 1) {
      const len = 1 + Math.floor(rand() * 12);
      let src = '';
      for (let k = 0; k < len; k += 1) {
        src += alphabet[Math.floor(rand() * alphabet.length)];
      }
      const parts = explainPattern(src);
      expect(parts.map((p) => p.token).join(''), `паттерн ${JSON.stringify(src)}`).toBe(src);
    }
  });
});

/* --- 2. Наборы: сверка членства с движком --------------------------- */

describe('наборы [...] совпадают с движком посимвольно', () => {
  const SET_PATTERNS = [
    '[a-z]', '[^a-z]', '[a-zA-Z0-9_]', '[\\d]', '[^\\d]', '[\\w]', '[\\W]',
    '[\\s]', '[\\S]', '[\\d\\s]', '[abc]', '[^abc]', '[a-]', '[-a]',
    '[\\d-z]', '[\\b]', '[\\t\\n]', '[\\x41-\\x5A]', '[0-9a-fA-F]',
    '[^\\w\\s]', '[]', '[^]', '[.*+?]', '[\\]\\[]', '[ -/]',
  ];

  it('каждый разобранный набор описывает ровно то множество, что и RegExp', () => {
    const probes: number[] = [];
    for (let cp = 0; cp <= 0x2fff; cp += 1) probes.push(cp);
    probes.push(0x3000, 0xfeff, 0xff21);

    // Расхождения копим, а не проверяем по одному: 25 наборов на 12 тысяч
    // символов — это триста тысяч сравнений, и expect на каждое съедает минуты.
    const mismatches: string[] = [];

    for (const src of SET_PATTERNS) {
      const parts = explainPattern(src);
      expect(parts, `паттерн ${src}`).toHaveLength(1);
      const set = parts[0].charSet;
      expect(set, `паттерн ${src} должен быть разобран как набор`).toBeDefined();
      if (!set) continue;

      const re = new RegExp(`^${src}$`);
      for (const cp of probes) {
        const engine = re.test(String.fromCodePoint(cp));
        if (setContains(set, cp) !== engine) {
          const hex = cp.toString(16).toUpperCase().padStart(4, '0');
          mismatches.push(`${src}: U+${hex} — движок ${engine}, объяснение ${!engine}`);
        }
      }
    }

    expect(mismatches.slice(0, 20)).toEqual([]);
  });
});

/* --- 3. Квантификаторы: сверка границ с движком ---------------------- */

describe('счётчики повторов совпадают с движком', () => {
  const QUANTIFIED = [
    'a*', 'a+', 'a?', 'a{3}', 'a{3,}', 'a{2,4}', 'a+?', 'a{2,4}?',
    '\\d*', '\\d{1,3}', '\\w{4}', '[a-z]{2,5}', '[^x]{0,2}', '\\.{3,}',
    '\\x41{2}', 'z{10,12}',
  ];

  /** Ищет символ, с которым совпадает база (то, к чему приклеен счётчик). */
  const sampleFor = (base: string): string | null => {
    for (let cp = 0x20; cp <= 0x7e; cp += 1) {
      const ch = String.fromCharCode(cp);
      try {
        if (new RegExp(`^(?:${base})$`).test(ch)) return ch;
      } catch { return null; }
    }
    return null;
  };

  it('заявленные min/max воспроизводятся на реальных строках', () => {
    for (const src of QUANTIFIED) {
      const parts = explainPattern(src);
      const part = parts.find((p) => p.quantifier);
      expect(part, `в ${src} должен быть счётчик`).toBeDefined();
      if (!part?.quantifier) continue;

      const q = part.quantifier;
      const base = part.token.slice(0, part.token.length - q.raw.length);
      const sample = sampleFor(base);
      expect(sample, `не подобран символ для базы ${base}`).not.toBeNull();
      if (sample === null) continue;

      const re = new RegExp(`^(?:${part.token})$`);
      const upper = (q.max ?? q.min) + 3;
      for (let n = 0; n <= upper; n += 1) {
        const expected = n >= q.min && (q.max === null || n <= q.max);
        const actual = re.test(sample.repeat(n));
        expect(actual, `${src}: ${n} повтор(ов) — движок ${actual}, объяснение ${expected}`).toBe(expected);
      }
    }
  });
});

/* --- 4. Группы: сверка нумерации и имён с движком -------------------- */

describe('нумерация и имена групп совпадают с движком', () => {
  /** Сколько захватывающих групп видит сам движок. */
  const engineGroupCount = (src: string): number => {
    const probe = new RegExp(`${src}|`).exec('');
    return probe ? probe.length - 1 : 0;
  };

  const engineGroupNames = (src: string): string[] => {
    const probe = new RegExp(`${src}|`).exec('');
    return probe?.groups ? Object.keys(probe.groups) : [];
  };

  it('наибольший заявленный номер группы равен числу групп у движка', () => {
    for (const src of REAL_PATTERNS) {
      if (!compiles(src)) continue;
      const parts = explainPattern(src);
      const numbers = parts
        .map((p) => /capturing group (\d+)/.exec(p.description))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => parseInt(m[1], 10));
      const claimed = numbers.length > 0 ? Math.max(...numbers) : 0;
      expect(claimed, `паттерн ${src}`).toBe(engineGroupCount(src));
    }
  });

  it('заявленные имена групп совпадают с именами у движка', () => {
    for (const src of REAL_PATTERNS) {
      if (!compiles(src)) continue;
      const claimed = explainPattern(src)
        .map((p) => /named "([^"]+)"/.exec(p.description))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => m[1]);
      const unique = [...new Set(claimed)].sort();
      expect(unique, `паттерн ${src}`).toEqual(engineGroupNames(src).sort());
    }
  });
});

/* --- 5. Честность: разобрано ⇔ компилируется ------------------------- */

describe('пометка «не разобрано» согласована с движком', () => {
  it('корректные реальные выражения разбираются целиком', () => {
    for (const src of REAL_PATTERNS) {
      expect(compiles(src), `паттерн ${src} должен компилироваться`).toBe(true);
      const bad = explainPattern(src).filter((p: ExplanationPart) => !p.parsed);
      expect(bad.map((p) => `${p.token}: ${p.description}`), `паттерн ${src}`).toEqual([]);
    }
  });

  it('несобираемые выражения обязательно содержат неразобранный кусок', () => {
    // Если движок паттерн отвергает, панель не имеет права выглядеть довольной.
    const broken = [
      '(a', 'a)', '*', '{2}', '[z-a]', 'a{3,2}', '[abc', '(?P<n>x)', '\\',
      '+', '?a', '(?<x>a)\\k<y>', '^*', '\\b*',
    ];
    for (const src of broken) {
      expect(compiles(src), `паттерн ${src} должен быть невалидным`).toBe(false);
      const bad = explainPattern(src).filter((p) => !p.parsed);
      expect(bad.length, `паттерн ${src} разобран без единой жалобы`).toBeGreaterThan(0);
    }
  });

  /**
   * Широкий корпус выражений «из жизни» вместе с флагами. Здесь важны не
   * подписи, а согласие с движком: что он собирает — должно быть разобрано
   * целиком, что отвергает — обязано быть помечено. В хвосте нарочно лежит
   * синтаксис других языков (Python, PCRE), который в JavaScript не работает.
   */
  const CORPUS: [string, string][] = [
    ['^[\\w.%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,63}$', ''],
    ['^(?:\\+?1[-. ]?)?\\(?([0-9]{3})\\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})$', ''],
    ['^(?:25[0-5]|2[0-4]\\d|[01]?\\d?\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|[01]?\\d?\\d)){3}$', ''],
    ['^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$', ''],
    ['^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]{8,}$', ''],
    ['^(\\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$', ''],
    ['(?<hours>\\d{2}):(?<minutes>\\d{2}):(?<seconds>\\d{2})', ''],
    ['^https?:\\/\\/(?:www\\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\\.[a-zA-Z0-9()]{1,6}\\b', ''],
    ['<a\\s+(?:[^>]*?\\s+)?href=(["\'])(.*?)\\1', 'gi'],
    ['^\\s*(?:\\/\\/|#).*$', 'm'],
    ['\\/\\*[\\s\\S]*?\\*\\/', 'g'],
    ['(?<=\\bclass\\s)\\w+', 'g'],
    ['(?<!\\w)\\d{3}(?!\\w)', 'g'],
    ['\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b', 'g'],
    ['([A-Z][a-z]+)\\s\\1', 'g'],
    ['^\\p{Lu}\\p{Ll}+$', 'u'],
    ['\\p{Script=Cyrillic}+', 'u'],
    ['^[\\u0400-\\u04FF]+$', ''],
    ['\\u{1F600}', 'u'],
    ['[\\t\\n\\r\\f\\v ]+', 'g'],
    ['^\\$\\d+(?:\\.\\d{2})?$', ''],
    ['^-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?$', ''],
    ['^#(?:[0-9a-f]{3}|[0-9a-f]{6})$', 'i'],
    ['^.{0,255}$', 's'],
    ['\\bcolou?rs?\\b', 'gi'],
    ['^(?!.*--)[a-z0-9-]+$', ''],
    ['^\\d{5}(?:-\\d{4})?$', ''],
    ['[^\\x00-\\x7F]+', 'g'],
    ['^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$', ''],
    ['\\{\\{\\s*(\\w+)\\s*\\}\\}', 'g'],
    ['^a{2,}?b+?c??$', ''],
    ['\\Qliteral\\E', ''],
    ['[[:alpha:]]+', ''],
    ['(?i)case', ''],
    ['(?P<name>\\w+)', ''],
    ['(?:^|,)(?=[^"]|(")?)"?((?(1)[^"]*|[^,"]*))"?(?=,|$)', ''],
  ];

  it('на широком корпусе «разобрано» совпадает с «компилируется»', () => {
    const wrong: string[] = [];
    for (const [src, flags] of CORPUS) {
      const valid = compiles(src, flags);
      const parts = explainPattern(src, flags);

      if (parts.map((p) => p.token).join('') !== src) {
        wrong.push(`${src} — разбор потерял символы`);
      }
      const unparsed = parts.filter((p) => !p.parsed);
      if (valid && unparsed.length > 0) {
        wrong.push(`${src} /${flags} собирается движком, но помечен «не разобрано»: ${unparsed.map((p) => p.token).join(', ')}`);
      }
      if (!valid && unparsed.length === 0) {
        wrong.push(`${src} /${flags} движок отвергает, а панель довольна`);
      }
    }
    expect(wrong).toEqual([]);
  });

  /**
   * Зафиксированные пробелы разбора.
   *
   * Это не «тест ради зелёной галочки», а замок на честность: разбор применяет
   * послабления Annex B независимо от флага u, хотя под u движок строже, и не
   * ловит повтор имени группы. В этих случаях панель показать виноватый кусок не
   * может — и поэтому App.tsx выводит отдельную оговорку, когда движок паттерн
   * отверг, а разбор ни к чему не придрался.
   *
   * Если кто-то научит разбор этим правилам, тест упадёт и список надо
   * сократить. Молча превратиться в ложное «всё разобрано» он не даст.
   */
  it('известные пробелы разбора перечислены и не разрослись', () => {
    const knownGaps: [string, string][] = [
      ['a{', 'u'],
      ['\\q', 'u'],
      [']', 'u'],
      ['(?<n>a)(?<n>b)', ''],
    ];

    for (const [src, flags] of knownGaps) {
      expect(compiles(src, flags), `${src} /${flags} должен быть невалидным`).toBe(false);
      const unparsed = explainPattern(src, flags).filter((p) => !p.parsed);
      expect(unparsed.length, `${src} /${flags} теперь ловится — уберите его из списка пробелов`).toBe(0);
    }
  });

  it('ни одно объяснение не называет разобранное «литералом» ошибочно', () => {
    // Ровно та поломка, ради которой всё переписано: \d, \b, \s, $ и наборы
    // раньше подписывались как литералы.
    const notLiterals = ['\\d', '\\D', '\\w', '\\W', '\\s', '\\S', '\\b', '\\B', '$', '[a-z]', '(?:a)', '(?=a)'];
    for (const src of notLiterals) {
      // Проверяется ведущая конструкция: в (?:a) буква "a" литералом как раз и
      // является, а вот сама скобка — нет.
      const first = explainPattern(src)[0];
      expect(first.description, `паттерн ${src}`).not.toMatch(/^Literal/);
      expect(first.description, `паттерн ${src}`).not.toMatch(/^The literal text/);
    }
  });
});

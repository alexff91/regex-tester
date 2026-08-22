import { describe, it, expect } from 'vitest';
import { explainPattern } from '../regex-utils';
import type { ExplanationPart } from '../regex-utils';

/**
 * Что здесь проверяется.
 *
 * Прошлая версия explainPattern знала только ^ . * + ? | и подписывала всё
 * остальное как «Literal X»: \d объяснялось как «литерал d», $ — как «литерал
 * $», [a-z] — как пять отдельных литералов. Панель выглядела знающей и врала.
 *
 * Поэтому тесты идут парами по смыслу: сначала конструкции, на которых старый
 * код врал, потом граница честности — то, что разобрать нельзя, должно быть
 * помечено parsed === false, а не выдано за литерал.
 */

const tokens = (p: string, flags = ''): string[] => explainPattern(p, flags).map((x) => x.token);
const descriptions = (p: string, flags = ''): string[] => explainPattern(p, flags).map((x) => x.description);
const only = (p: string, flags = ''): ExplanationPart => {
  const parts = explainPattern(p, flags);
  expect(parts).toHaveLength(1);
  return parts[0];
};

describe('классы символов — старый код звал их литералами', () => {
  it('\\d — цифра, а не «литерал d»', () => {
    const part = only('\\d');
    expect(part.token).toBe('\\d');
    expect(part.description).toBe('Any digit: 0-9');
    expect(part.description).not.toMatch(/literal/i);
  });

  it('\\D — отрицание цифры', () => {
    expect(only('\\D').description).toBe('Any character except a digit 0-9');
  });

  it('\\w — словесный символ', () => {
    expect(only('\\w').description).toBe('Any word character: A-Z, a-z, 0-9 or _');
  });

  it('\\W — отрицание словесного символа', () => {
    expect(only('\\W').description).toMatch(/except A-Z, a-z, 0-9 and _/);
  });

  it('\\s — пробельный символ', () => {
    expect(only('\\s').description).toMatch(/^Any whitespace/);
  });

  it('\\S — непробельный символ', () => {
    expect(only('\\S').description).toBe('Any character that is not whitespace');
  });

  it('\\b — граница слова, нулевой ширины', () => {
    const part = only('\\b');
    expect(part.description).toMatch(/Word boundary/);
    expect(part.description).toMatch(/zero-width/);
    expect(part.description).not.toMatch(/literal/i);
  });

  it('\\B — не граница слова', () => {
    expect(only('\\B').description).toMatch(/^Not a word boundary/);
  });
});

describe('якоря', () => {
  it('$ — конец строки, а не «литерал $»', () => {
    const part = only('$');
    expect(part.kind).toBe('anchor');
    expect(part.description).toMatch(/End of the string/);
    expect(part.description).not.toMatch(/literal/i);
  });

  it('^ без флага m — начало всей строки', () => {
    expect(only('^').description).toMatch(/Start of the string/);
  });

  it('^ с флагом m — начало строки текста', () => {
    // Смысл якоря зависит от флагов, поэтому объяснение обязано их учитывать.
    expect(only('^', 'm').description).toMatch(/Start of a line/);
  });

  it('$ с флагом m — конец строки текста', () => {
    expect(only('$', 'm').description).toMatch(/End of a line/);
  });
});

describe('точка зависит от флага s', () => {
  it('без s — любой символ кроме перевода строки', () => {
    expect(only('.').description).toMatch(/except a line break/);
  });
  it('с s — включая перевод строки', () => {
    expect(only('.', 's').description).toMatch(/including line breaks/);
  });
});

describe('квантификаторы приклеиваются к тому, что повторяют', () => {
  it('{2,4} — диапазон повторов, а не четыре литерала', () => {
    const part = only('a{2,4}');
    expect(part.token).toBe('a{2,4}');
    expect(part.description).toMatch(/2 to 4 times/);
    expect(part.quantifier).toEqual({ raw: '{2,4}', min: 2, max: 4, lazy: false });
  });

  it('{3} — ровно столько раз', () => {
    expect(only('a{3}').description).toMatch(/exactly 3 times/);
  });

  it('{3,} — не меньше стольки раз', () => {
    expect(only('a{3,}').description).toMatch(/3 or more times/);
  });

  it('ленивая форма +? отмечена как ленивая', () => {
    const part = only('a+?');
    expect(part.quantifier).toMatchObject({ min: 1, max: null, lazy: true });
    expect(part.description).toMatch(/lazily/);
  });

  it('ленивая {2,4}? тоже', () => {
    expect(only('a{2,4}?').quantifier).toMatchObject({ min: 2, max: 4, lazy: true });
  });

  it('в abc+ повторяется только c', () => {
    // Классическая ловушка: quantifier относится к последнему символу, а не ко
    // всему тексту слева.
    expect(tokens('abc+')).toEqual(['ab', 'c+']);
    expect(descriptions('abc+')[0]).toMatch(/literal text "ab"/);
    expect(descriptions('abc+')[1]).toMatch(/one or more times/);
  });

  it('квантификатор после группы относится ко всей группе', () => {
    const parts = explainPattern('(ab)+');
    expect(parts.map((p) => p.token)).toEqual(['(', 'ab', ')', '+']);
    expect(parts[3].description).toMatch(/group above is repeated/);
  });
});

describe('группы', () => {
  it('захватывающие группы нумеруются', () => {
    const parts = explainPattern('(a)(b)');
    expect(parts[0].description).toMatch(/capturing group 1/);
    expect(parts[3].description).toMatch(/capturing group 2/);
  });

  it('(?: ) — не захватывающая', () => {
    const parts = explainPattern('(?:a)');
    expect(parts[0].token).toBe('(?:');
    expect(parts[0].description).toMatch(/non-capturing/);
  });

  it('(?<name> ) — именованная захватывающая', () => {
    const parts = explainPattern('(?<year>\\d)');
    expect(parts[0].token).toBe('(?<year>');
    expect(parts[0].description).toMatch(/named "year"/);
    expect(parts[0].description).toMatch(/group 1/);
  });

  it('(?= ) и (?! ) — просмотр вперёд', () => {
    expect(explainPattern('(?=a)')[0].description).toMatch(/^Start of a lookahead/);
    expect(explainPattern('(?!a)')[0].description).toMatch(/^Start of a negative lookahead/);
  });

  it('(?<= ) и (?<! ) — просмотр назад, а не именованная группа', () => {
    // Шаблон именованной группы легко спутать с просмотром назад: (?<name> и (?<=
    expect(explainPattern('(?<=a)')[0].token).toBe('(?<=');
    expect(explainPattern('(?<=a)')[0].description).toMatch(/^Start of a lookbehind/);
    expect(explainPattern('(?<!a)')[0].description).toMatch(/^Start of a negative lookbehind/);
  });

  it('вложенность отражена в depth', () => {
    const parts = explainPattern('((a))');
    expect(parts.map((p) => p.depth)).toEqual([0, 1, 2, 1, 0]);
  });
});

describe('альтернативы', () => {
  it('| разбирается как альтернатива', () => {
    const parts = explainPattern('a|b');
    expect(parts[1].kind).toBe('alternation');
    expect(parts[1].description).toMatch(/Alternation/);
  });
});

describe('наборы и диапазоны', () => {
  it('[a-z] — один диапазон, а не пять литералов', () => {
    const part = only('[a-z]');
    expect(part.token).toBe('[a-z]');
    expect(part.charSet).toEqual({
      negated: false,
      items: [{ kind: 'range', raw: 'a-z', from: 'a', to: 'z' }],
    });
    expect(part.description).toBe('One character out of: "a" to "z"');
  });

  it('[^0-9] — отрицание набора', () => {
    const part = only('[^0-9]');
    expect(part.charSet?.negated).toBe(true);
    expect(part.description).toMatch(/^One character that is none of/);
  });

  it('[a-z0-9_] — смешанный набор', () => {
    const part = only('[a-z0-9_]');
    expect(part.charSet?.items).toHaveLength(3);
    expect(part.description).toBe('One character out of: "a" to "z", "0" to "9", "_"');
  });

  it('[\\d\\s] — классы внутри набора', () => {
    const part = only('[\\d\\s]');
    expect(part.charSet?.items.map((i) => i.kind)).toEqual(['class', 'class']);
  });

  it('[\\b] — это backspace, а НЕ граница слова', () => {
    // Главная ловушка наборов. Проверено на движке: /^[\b]$/ совпадает с U+0008.
    const part = only('[\\b]');
    expect(part.charSet?.items).toEqual([{ kind: 'char', raw: '\\b', ch: '\b' }]);
    expect(part.description).toMatch(/backspace/);
    expect(part.description).not.toMatch(/boundary/i);
  });

  it('[\\d-z] — дефис рядом с классом становится обычным символом', () => {
    // Проверено на движке: /^[\d-z]$/ совпадает с "5", "-" и "z", но не с "a".
    const part = only('[\\d-z]');
    expect(part.charSet?.items).toEqual([
      { kind: 'class', raw: '\\d', cls: 'd' },
      { kind: 'char', raw: '-', ch: '-' },
      { kind: 'char', raw: 'z', ch: 'z' },
    ]);
  });

  it('[a-] — дефис в конце набора это литерал', () => {
    expect(only('[a-]').charSet?.items).toEqual([
      { kind: 'char', raw: 'a', ch: 'a' },
      { kind: 'char', raw: '-', ch: '-' },
    ]);
  });

  it('[^] — любой символ, включая перевод строки', () => {
    expect(only('[^]').description).toMatch(/Any character at all/);
  });

  it('[] — пустой набор не совпадает ни с чем', () => {
    expect(only('[]').description).toMatch(/matches nothing/);
  });

  it('набор с квантификатором остаётся одним куском', () => {
    const part = only('[a-z]+');
    expect(part.token).toBe('[a-z]+');
    expect(part.quantifier).toMatchObject({ min: 1, max: null });
  });
});

describe('экранированные символы', () => {
  it('\\. — точка как обычный символ, а не два литерала', () => {
    const part = only('\\.');
    expect(part.token).toBe('\\.');
    expect(part.description).toMatch(/Literal "\." — the backslash removes its special meaning/);
  });

  it('\\\\ — сама обратная косая', () => {
    expect(only('\\\\').description).toMatch(/removes its special meaning/);
  });

  it('\\n — перевод строки по имени', () => {
    expect(only('\\n').description).toMatch(/line feed \(U\+000A\)/);
  });

  it('\\t — табуляция', () => {
    expect(only('\\t').description).toMatch(/tab \(U\+0009\)/);
  });

  it('\\x41 — символ по шестнадцатеричному коду', () => {
    expect(only('\\x41').description).toBe('The character "A"');
  });

  it('\\u0041 — символ по коду', () => {
    expect(only('\\u0041').description).toBe('The character "A"');
  });

  it('\\cA — управляющий символ', () => {
    expect(only('\\cA').description).toMatch(/Control character Ctrl-A \(U\+0001\)/);
  });

  it('\\q — бесполезное экранирование названо бесполезным', () => {
    expect(only('\\q').description).toMatch(/the backslash has no effect/);
  });
});

describe('обратные ссылки', () => {
  it('\\1 при существующей группе — обратная ссылка', () => {
    const parts = explainPattern('(a)\\1');
    expect(parts[3].kind).toBe('backref');
    expect(parts[3].description).toMatch(/text captured by group 1/);
  });

  it('\\k<name> при существующей именованной группе', () => {
    const parts = explainPattern('(?<x>a)\\k<x>');
    const ref = parts[parts.length - 1];
    expect(ref.kind).toBe('backref');
    expect(ref.description).toMatch(/group named "x"/);
  });

  it('\\1 без единой группы не выдаётся за обратную ссылку', () => {
    // Движок здесь молча уходит в legacy-восьмеричный escape: /^\1$/ совпадает
    // с U+0001. Угадывать это не наше дело — честнее сказать «не разобрано».
    const part = only('\\1');
    expect(part.parsed).toBe(false);
    expect(part.description).toMatch(/Not parsed/);
  });
});

describe('флаг u включает конструкции, которых без него нет', () => {
  it('\\p{L} с флагом u — свойство Unicode', () => {
    expect(only('\\p{L}', 'u').description).toMatch(/Unicode property L/);
  });

  it('\\p{L} без флага u — это литерал p и повтор {L} не квантификатор', () => {
    // Проверено на движке: /^\p{L}$/ без флага совпадает со строкой "p{L}".
    const parts = explainPattern('\\p{L}');
    expect(parts.map((p) => p.token).join('')).toBe('\\p{L}');
    expect(parts[0].description).toMatch(/Literal "p"/);
  });

  it('\\u{41} без флага u — это буква u, повторённая 41 раз', () => {
    // Одна из самых коварных ловушек: проверено на движке, /^\u{41}$/ без флага
    // совпадает со строкой из 41 буквы "u".
    const part = only('\\u{41}');
    expect(part.quantifier).toMatchObject({ min: 41, max: 41 });
    expect(part.description).toMatch(/exactly 41 times/);
  });

  it('\\u{41} с флагом u — символ A', () => {
    expect(only('\\u{41}', 'u').description).toMatch(/"A"/);
  });
});

describe('честное «не разобрано» вместо выдуманного литерала', () => {
  it('незакрытая группа помечена как неразобранная', () => {
    const parts = explainPattern('(a');
    expect(parts[0].parsed).toBe(false);
    expect(parts[0].description).toMatch(/never closed/);
  });

  it('лишняя ) помечена как неразобранная', () => {
    const parts = explainPattern('a)');
    expect(parts[1].parsed).toBe(false);
    expect(parts[1].description).toMatch(/no matching "\("/);
  });

  it('квантификатор без атома слева', () => {
    const part = only('*');
    expect(part.parsed).toBe(false);
    expect(part.description).toMatch(/nothing to repeat/);
  });

  it('{2} в начале паттерна — тоже «нечего повторять»', () => {
    // Проверено на движке: new RegExp('{2}') падает с «Nothing to repeat»,
    // хотя new RegExp('a{') валиден. Разница неочевидна, и её надо соблюсти.
    expect(only('{2}').parsed).toBe(false);
  });

  it('a{ — а вот здесь { действительно литерал', () => {
    // Проверено на движке: /a{/ валиден и совпадает с "a{".
    const part = only('a{');
    expect(part.parsed).toBe(true);
    expect(part.description).toMatch(/literal text "a\{"/);
  });

  it('перевёрнутый диапазон [z-a]', () => {
    const part = only('[z-a]');
    expect(part.parsed).toBe(false);
    expect(part.description).toMatch(/runs backwards/);
  });

  it('перевёрнутый счётчик a{3,2}', () => {
    const parts = explainPattern('a{3,2}');
    const bad = parts.find((p) => !p.parsed);
    expect(bad?.description).toMatch(/upper bound is smaller/);
  });

  it('незакрытый набор [abc', () => {
    const part = only('[abc');
    expect(part.parsed).toBe(false);
    expect(part.description).toMatch(/never closed/);
  });

  it('чужой синтаксис (?P<n>x) не выдаётся за что-то знакомое', () => {
    // Синтаксис Python. В JavaScript такого нет, и делать вид, что мы его знаем,
    // — ровно та ошибка, ради которой всё это переписано.
    const parts = explainPattern('(?P<n>x)');
    expect(parts[0].parsed).toBe(false);
    expect(parts[0].description).toMatch(/unknown group syntax/);
  });

  it('одинокая обратная косая в конце', () => {
    const part = only('\\');
    expect(part.parsed).toBe(false);
    expect(part.description).toMatch(/trailing backslash/);
  });

  it('ни одно описание не называет неразобранное литералом', () => {
    for (const src of ['*', '{2}', '[z-a]', '(?P<n>x)', '\\', 'a)', '(a', '[abc']) {
      for (const part of explainPattern(src)) {
        if (part.parsed) continue;
        expect(part.description).toMatch(/^Not parsed/);
        expect(part.description).not.toMatch(/^Literal/);
      }
    }
  });
});

describe('обычный текст', () => {
  it('пробег литералов склеивается в один кусок', () => {
    expect(tokens('abc')).toEqual(['abc']);
  });
  it('пустой паттерн даёт пустой разбор', () => {
    expect(explainPattern('')).toEqual([]);
  });
});

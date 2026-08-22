/**
 * Разбор паттерна для панели «Pattern Explanation».
 *
 * ПОЧЕМУ этот модуль написан так подробно.
 * Панель стоит рядом с результатом и читается как справка — человек верит тому,
 * что в ней написано. Прошлая версия разбирала только ^ . * + ? | , а всё
 * остальное подписывала «Literal X»: \d объяснялось как «литерал d», \b — как
 * «литерал b». Панель выглядела знающей и при этом уверенно врала.
 *
 * Отсюда главное правило модуля: если конструкция не разобрана, это должно быть
 * ВИДНО (parsed === false), а не замаскировано под литерал. Признать незнание
 * дешевле, чем ошибиться: по неверному объяснению человек чинит не то.
 *
 * Всё поведение ниже сверено с настоящим движком RegExp в Node, а не выведено
 * из головы. Неочевидные места помечены комментариями с результатом проверки.
 */

export type CharClassLetter = 'd' | 'D' | 'w' | 'W' | 's' | 'S';

/**
 * Элемент набора [...]. Структура машинночитаемая специально: по ней тест может
 * независимо посчитать, какие символы попадают в набор, и сверить с движком.
 */
export type SetItem =
  | { kind: 'char'; raw: string; ch: string }
  | { kind: 'range'; raw: string; from: string; to: string }
  | { kind: 'class'; raw: string; cls: CharClassLetter };

export interface Quantifier {
  raw: string;
  min: number;
  /** null означает «без верхней границы» */
  max: number | null;
  lazy: boolean;
}

export type PartKind =
  | 'literal'
  | 'dot'
  | 'anchor'
  | 'boundary'
  | 'class'
  | 'set'
  | 'escape'
  | 'backref'
  | 'group-open'
  | 'group-close'
  | 'alternation'
  | 'quantifier'
  | 'unparsed';

export interface ExplanationPart {
  token: string;
  description: string;
  /** false — конструкцию разобрать не удалось; описание об этом честно говорит */
  parsed: boolean;
  kind: PartKind;
  /** вложенность в группы, 0 — верхний уровень */
  depth: number;
  /** квантификатор, приклеенный к этому атому (для `a+` это `+`) */
  quantifier?: Quantifier;
  /** разобранное содержимое набора [...] */
  charSet?: { negated: boolean; items: SetItem[] };
}

/* ------------------------------------------------------------------ */
/* Справочные таблицы                                                  */
/* ------------------------------------------------------------------ */

/** Символы, на которых обрывается «пробег» обычных литералов. */
const SYNTAX_CHARS = new Set(['^', '$', '\\', '.', '*', '+', '?', '(', ')', '[', '|']);

/**
 * `]` и `}` без пары движок считает обычными литералами — проверено:
 * new RegExp(']') и new RegExp('}') валидны. Поэтому их здесь нет.
 */

const CONTROL_ESCAPES: Record<string, string> = {
  n: '\n',
  r: '\r',
  t: '\t',
  f: '\f',
  v: '\v',
};

const CLASS_LONG: Record<CharClassLetter, string> = {
  d: 'Any digit: 0-9',
  D: 'Any character except a digit 0-9',
  w: 'Any word character: A-Z, a-z, 0-9 or _',
  W: 'Any character except A-Z, a-z, 0-9 and _',
  s: 'Any whitespace: space, tab, line break, form feed, vertical tab and the Unicode spaces',
  S: 'Any character that is not whitespace',
};

/** Короткие подписи — для перечисления внутри набора [...]. */
const CLASS_SHORT: Record<CharClassLetter, string> = {
  d: 'a digit 0-9',
  D: 'a non-digit',
  w: 'a word character (A-Z a-z 0-9 _)',
  W: 'a non-word character',
  s: 'a whitespace character',
  S: 'a non-whitespace character',
};

const CHAR_NAMES: Record<string, string> = {
  '\n': 'line feed',
  '\r': 'carriage return',
  '\t': 'tab',
  '\f': 'form feed',
  '\v': 'vertical tab',
  '\0': 'NUL',
  '\b': 'backspace',
  ' ': 'space',
};

/* ------------------------------------------------------------------ */
/* Мелкие помощники                                                    */
/* ------------------------------------------------------------------ */

function hex4(code: number): string {
  return code.toString(16).toUpperCase().padStart(4, '0');
}

/** Как показать символ человеку: печатный — в кавычках, управляющий — по имени. */
function showChar(ch: string): string {
  const code = ch.codePointAt(0) ?? 0;
  const named = CHAR_NAMES[ch];
  if (named) return `${named} (U+${hex4(code)})`;
  if (code < 0x20 || code === 0x7f) return `U+${hex4(code)}`;
  return `"${ch}"`;
}

function quantifierPhrase(q: Quantifier): string {
  let base: string;
  if (q.min === 0 && q.max === null) base = 'zero or more times';
  else if (q.min === 1 && q.max === null) base = 'one or more times';
  else if (q.min === 0 && q.max === 1) base = 'optional: zero or one time';
  else if (q.max === null) base = `${q.min} or more times`;
  else if (q.min === q.max) base = `exactly ${q.min} time${q.min === 1 ? '' : 's'}`;
  else base = `${q.min} to ${q.max} times`;
  // Ленивая форма меняет не множество совпадений, а какое из них будет выбрано,
  // поэтому пишем её отдельной оговоркой, а не переписываем счётчик.
  return q.lazy ? `${base}, lazily (prefers the shortest match)` : base;
}

function unparsedPart(token: string, why: string, depth: number): ExplanationPart {
  return { token, description: `Not parsed — ${why}`, parsed: false, kind: 'unparsed', depth };
}

/* ------------------------------------------------------------------ */
/* Квантификаторы                                                      */
/* ------------------------------------------------------------------ */

/**
 * Читает квантификатор в позиции i. Возвращает null, если его там нет.
 *
 * Важно: `{` без корректного тела квантификатором НЕ является — движок считает
 * его обычным литералом (проверено: /a{/ валиден и совпадает с "a{", а /a{1/ —
 * с "a{1"). Поэтому шаблон ниже строгий, и промах честно означает «это литерал».
 */
export function readQuantifier(p: string, i: number): Quantifier | null {
  const c = p[i];
  let min: number;
  let max: number | null;
  let len: number;

  if (c === '*') { min = 0; max = null; len = 1; }
  else if (c === '+') { min = 1; max = null; len = 1; }
  else if (c === '?') { min = 0; max = 1; len = 1; }
  else if (c === '{') {
    const m = /^\{(\d+)(,(\d*))?\}/.exec(p.slice(i));
    if (!m) return null;
    min = parseInt(m[1], 10);
    if (m[2] === undefined) max = min;
    else if (m[3] === '') max = null;
    else max = parseInt(m[3], 10);
    len = m[0].length;
  } else return null;

  let lazy = false;
  if (p[i + len] === '?') { lazy = true; len += 1; }
  return { raw: p.slice(i, i + len), min, max, lazy };
}

/* ------------------------------------------------------------------ */
/* Предварительный обход: сколько групп и как их зовут                 */
/* ------------------------------------------------------------------ */

/**
 * Считает захватывающие группы до основного разбора.
 *
 * ПОЧЕМУ отдельным проходом: смысл `\1` и `\k<name>` зависит от того, есть ли
 * такая группа ДАЛЬШЕ по паттерну. Без этого знания обратную ссылку от
 * legacy-восьмеричного escape не отличить — проверено: /\1/ без групп валиден и
 * совпадает с U+0001, а не с обратной ссылкой.
 */
export function scanGroups(p: string): { count: number; names: string[] } {
  let count = 0;
  const names: string[] = [];
  let i = 0;
  let inClass = false;

  while (i < p.length) {
    const c = p[i];
    if (c === '\\') { i += 2; continue; }
    if (inClass) { if (c === ']') inClass = false; i += 1; continue; }
    if (c === '[') { inClass = true; i += 1; continue; }
    if (c === '(') {
      if (p[i + 1] === '?') {
        // (?<name>  — захватывающая; (?<=  и  (?<!  — нет, поэтому шаблон
        // требует после `<` идентификатор, а не `=`/`!`.
        const m = /^\(\?<([A-Za-z_$][A-Za-z0-9_$]*)>/.exec(p.slice(i));
        if (m) { count += 1; names.push(m[1]); }
      } else {
        count += 1;
      }
    }
    i += 1;
  }
  return { count, names };
}

/* ------------------------------------------------------------------ */
/* Наборы [...]                                                        */
/* ------------------------------------------------------------------ */

type ClassAtom = { item: SetItem; len: number };

/** Читает один элемент внутри [...] — символ или класс вроде \d. */
function readClassAtom(p: string, i: number): ClassAtom | null {
  const c = p[i];
  if (c === undefined) return null;

  if (c !== '\\') {
    return { item: { kind: 'char', raw: c, ch: c }, len: 1 };
  }

  const n = p[i + 1];
  if (n === undefined) return null;

  // ГЛАВНАЯ ЛОВУШКА НАБОРОВ: внутри [...] \b — это НЕ граница слова, а символ
  // backspace U+0008. Проверено на движке: /^[\b]$/ совпадает с "".
  if (n === 'b') return { item: { kind: 'char', raw: '\\b', ch: '\b' }, len: 2 };

  if (n === 'd' || n === 'D' || n === 'w' || n === 'W' || n === 's' || n === 'S') {
    return { item: { kind: 'class', raw: `\\${n}`, cls: n }, len: 2 };
  }

  if (CONTROL_ESCAPES[n] !== undefined) {
    return { item: { kind: 'char', raw: `\\${n}`, ch: CONTROL_ESCAPES[n] }, len: 2 };
  }

  if (n === '0' && !/\d/.test(p[i + 2] ?? '')) {
    return { item: { kind: 'char', raw: '\\0', ch: '\0' }, len: 2 };
  }

  const hex = /^\\x([0-9a-fA-F]{2})/.exec(p.slice(i));
  if (hex) {
    return { item: { kind: 'char', raw: hex[0], ch: String.fromCharCode(parseInt(hex[1], 16)) }, len: hex[0].length };
  }

  const uni = /^\\u([0-9a-fA-F]{4})/.exec(p.slice(i));
  if (uni) {
    return { item: { kind: 'char', raw: uni[0], ch: String.fromCharCode(parseInt(uni[1], 16)) }, len: uni[0].length };
  }

  const ctrl = /^\\c([A-Za-z])/.exec(p.slice(i));
  if (ctrl) {
    const code = ctrl[1].toUpperCase().charCodeAt(0) - 64;
    return { item: { kind: 'char', raw: ctrl[0], ch: String.fromCharCode(code) }, len: ctrl[0].length };
  }

  // Всё прочее — identity escape: обратная косая просто снимает особый смысл.
  // Проверено: /^[\B]$/ совпадает с "B".
  return { item: { kind: 'char', raw: `\\${n}`, ch: n }, len: 2 };
}

interface ParsedClass {
  len: number;
  negated: boolean;
  items: SetItem[];
  error?: string;
}

/**
 * Ищет закрывающую `]`. Отдельным проходом — чтобы при ошибке внутри набора
 * подписать целиком весь `[...]`, а не половину, оставив хвост притворяться
 * обычным текстом.
 *
 * Внимание: в JavaScript `]` сразу после `[` НЕ считается литералом (в отличие
 * от POSIX): проверено, /^[]$/ валиден и не совпадает ни с чем.
 */
function findClassEnd(p: string, start: number): number {
  let i = start + 1;
  if (p[i] === '^') i += 1;
  while (i < p.length) {
    if (p[i] === '\\') { i += 2; continue; }
    if (p[i] === ']') return i;
    i += 1;
  }
  return -1;
}

function parseCharClass(p: string, start: number): ParsedClass {
  const closeAt = findClassEnd(p, start);
  if (closeAt === -1) {
    return {
      len: p.length - start,
      negated: p[start + 1] === '^',
      items: [],
      error: 'the character class is never closed with "]", so this pattern will not compile',
    };
  }

  const fullLen = closeAt + 1 - start;
  let i = start + 1;
  let negated = false;
  if (p[i] === '^') { negated = true; i += 1; }

  const items: SetItem[] = [];

  while (i < closeAt) {
    const first = readClassAtom(p, i);
    if (!first) break;

    const afterFirst = i + first.len;
    const dashIsRange =
      p[afterFirst] === '-' &&
      afterFirst + 1 < closeAt;

    if (dashIsRange) {
      const second = readClassAtom(p, afterFirst + 1);
      if (second && first.item.kind === 'char' && second.item.kind === 'char') {
        const from = first.item.ch;
        const to = second.item.ch;
        if ((from.codePointAt(0) ?? 0) > (to.codePointAt(0) ?? 0)) {
          return {
            len: fullLen,
            negated,
            items,
            error: `the range ${showChar(from)}-${showChar(to)} runs backwards, so this pattern will not compile`,
          };
        }
        items.push({
          kind: 'range',
          raw: `${first.item.raw}-${second.item.raw}`,
          from,
          to,
        });
        i = afterFirst + 1 + second.len;
        continue;
      }
      if (second) {
        // Если хотя бы один край — класс вроде \d, дефис перестаёт быть
        // диапазоном и становится обычным символом. Проверено: /^[\d-z]$/
        // совпадает с "5", "-" и "z", но не с "a".
        items.push(first.item);
        items.push({ kind: 'char', raw: '-', ch: '-' });
        items.push(second.item);
        i = afterFirst + 1 + second.len;
        continue;
      }
    }

    items.push(first.item);
    i = afterFirst;
  }

  return { len: fullLen, negated, items };
}

function describeSetItem(it: SetItem): string {
  if (it.kind === 'class') return CLASS_SHORT[it.cls];
  if (it.kind === 'range') return `${showChar(it.from)} to ${showChar(it.to)}`;
  return showChar(it.ch);
}

function describeCharSet(negated: boolean, items: SetItem[]): string {
  if (items.length === 0) {
    // Пустой набор — не «любой символ», а провал. Проверено: /^[]$/ не совпадает
    // ни с чем, а /^[^]$/ совпадает с любым символом, включая перевод строки.
    return negated
      ? 'Any character at all, including line breaks'
      : 'Empty class — matches nothing, so this pattern can never succeed';
  }
  const list = items.map(describeSetItem).join(', ');
  return negated
    ? `One character that is none of: ${list}`
    : `One character out of: ${list}`;
}

/* ------------------------------------------------------------------ */
/* Экранированные последовательности вне набора                        */
/* ------------------------------------------------------------------ */

interface Ctx {
  multiline: boolean;
  dotAll: boolean;
  unicode: boolean;
  groupCount: number;
  groupNames: string[];
}

interface EscapeResult {
  len: number;
  description: string;
  kind: PartKind;
  parsed: boolean;
  /** можно ли навесить на это квантификатор */
  quantifiable: boolean;
}

function readEscape(p: string, i: number, ctx: Ctx): EscapeResult {
  const rest = p.slice(i);
  const n = p[i + 1];

  if (n === undefined) {
    return { len: 1, description: 'Not parsed — a trailing backslash, this pattern will not compile', kind: 'unparsed', parsed: false, quantifiable: false };
  }

  if (n === 'b' || n === 'B') {
    // Вне набора \b — граница слова. Внутри [...] тот же \b означает backspace,
    // это разные вещи, и readClassAtom обрабатывает их отдельно.
    const description = n === 'b'
      ? 'Word boundary — a zero-width position between a word character and a non-word character'
      : 'Not a word boundary — a zero-width position inside a word, or between two non-word characters';
    // \b* движок отвергает («Nothing to repeat»), поэтому квантификатор сюда не вешаем.
    return { len: 2, description, kind: 'boundary', parsed: true, quantifiable: false };
  }

  if (n === 'd' || n === 'D' || n === 'w' || n === 'W' || n === 's' || n === 'S') {
    return { len: 2, description: CLASS_LONG[n], kind: 'class', parsed: true, quantifiable: true };
  }

  if (CONTROL_ESCAPES[n] !== undefined) {
    const ch = CONTROL_ESCAPES[n];
    return { len: 2, description: `The ${showChar(ch)} character`, kind: 'escape', parsed: true, quantifiable: true };
  }

  if (n === '0' && !/\d/.test(p[i + 2] ?? '')) {
    return { len: 2, description: 'The NUL character (U+0000)', kind: 'escape', parsed: true, quantifiable: true };
  }

  const hex = /^\\x([0-9a-fA-F]{2})/.exec(rest);
  if (hex) {
    const ch = String.fromCharCode(parseInt(hex[1], 16));
    return { len: hex[0].length, description: `The character ${showChar(ch)}`, kind: 'escape', parsed: true, quantifiable: true };
  }

  // \u{...} работает только с флагом u. Без него это identity escape "u", к
  // которому приклеивается квантификатор {41} — проверено: /^\u{41}$/ без флага
  // совпадает со строкой из 41 буквы "u". Поэтому ветку сюда пускаем по флагу.
  if (ctx.unicode) {
    const big = /^\\u\{([0-9a-fA-F]{1,6})\}/.exec(rest);
    if (big) {
      const code = parseInt(big[1], 16);
      const ch = code <= 0x10ffff ? String.fromCodePoint(code) : '';
      return {
        len: big[0].length,
        description: ch ? `The character ${showChar(ch)} (U+${hex4(code)})` : `Not parsed — U+${big[1]} is outside the Unicode range`,
        kind: ch ? 'escape' : 'unparsed',
        parsed: Boolean(ch),
        quantifiable: true,
      };
    }
  }

  const uni = /^\\u([0-9a-fA-F]{4})/.exec(rest);
  if (uni) {
    const ch = String.fromCharCode(parseInt(uni[1], 16));
    return { len: uni[0].length, description: `The character ${showChar(ch)}`, kind: 'escape', parsed: true, quantifiable: true };
  }

  const ctrl = /^\\c([A-Za-z])/.exec(rest);
  if (ctrl) {
    const code = ctrl[1].toUpperCase().charCodeAt(0) - 64;
    return {
      len: ctrl[0].length,
      description: `Control character Ctrl-${ctrl[1].toUpperCase()} (U+${hex4(code)})`,
      kind: 'escape',
      parsed: true,
      quantifiable: true,
    };
  }

  if (n === 'c') {
    // \c без буквы движок трактует как три обычных символа: обратную косую, "c"
    // и следующий. Проверено: /^\c1$/ совпадает со строкой "\c1". Объяснять это
    // как что-то осмысленное было бы враньём.
    return { len: 2, description: 'Not parsed — "\\c" must be followed by a letter to name a control character', kind: 'unparsed', parsed: false, quantifiable: false };
  }

  if ((n === 'p' || n === 'P') && ctx.unicode) {
    const prop = /^\\[pP]\{([^}]*)\}/.exec(rest);
    if (prop) {
      const negated = n === 'P';
      return {
        len: prop[0].length,
        description: negated
          ? `Any character WITHOUT the Unicode property ${prop[1]}`
          : `Any character with the Unicode property ${prop[1]}`,
        kind: 'class',
        parsed: true,
        quantifiable: true,
      };
    }
    return { len: 2, description: `Not parsed — "\\${n}" needs a {property} after it when the u flag is on`, kind: 'unparsed', parsed: false, quantifiable: false };
  }

  if (n === 'k') {
    const named = /^\\k<([A-Za-z_$][A-Za-z0-9_$]*)>/.exec(rest);
    if (named && ctx.groupNames.includes(named[1])) {
      return {
        len: named[0].length,
        description: `Backreference — the exact text captured by the group named "${named[1]}"`,
        kind: 'backref',
        parsed: true,
        quantifiable: true,
      };
    }
    if (ctx.groupNames.length > 0) {
      const which = named ? `there is no group named "${named[1]}"` : '"\\k" must be followed by <name>';
      return { len: named ? named[0].length : 2, description: `Not parsed — ${which}, so this pattern will not compile`, kind: 'unparsed', parsed: false, quantifiable: false };
    }
    // Без единой именованной группы \k теряет особый смысл — проверено:
    // /^\k<x>$/ совпадает с литеральной строкой "k<x>".
    return { len: 2, description: 'Literal "k" — with no named groups in the pattern the backslash has no effect', kind: 'escape', parsed: true, quantifiable: true };
  }

  const dec = /^\\([1-9]\d*)/.exec(rest);
  if (dec) {
    const num = parseInt(dec[1], 10);
    if (num <= ctx.groupCount) {
      return {
        len: dec[0].length,
        description: `Backreference — the exact text captured by group ${num}`,
        kind: 'backref',
        parsed: true,
        quantifiable: true,
      };
    }
    // Движок здесь не падает, а уходит в legacy-режим: /\1/ без групп совпадает
    // с U+0001, а /\9/ — с "9". Правило разное и почти всегда это опечатка,
    // поэтому не угадываем, а честно говорим, что не разобрали.
    const has = ctx.groupCount === 1 ? 'is only 1 capturing group' : `are only ${ctx.groupCount} capturing groups`;
    return {
      len: dec[0].length,
      description: `Not parsed — "\\${dec[1]}" is not a backreference: there ${has} in this pattern`,
      kind: 'unparsed',
      parsed: false,
      quantifiable: false,
    };
  }

  // Identity escape. Для синтаксических символов это осмысленное экранирование,
  // для букв — бесполезное, и стоит сказать об этом прямо.
  const isSyntax = /[.*+?^${}()|[\]\\/\-]/.test(n);
  return {
    len: 2,
    description: isSyntax
      ? `Literal ${showChar(n)} — the backslash removes its special meaning`
      : `Literal ${showChar(n)} — the backslash has no effect on this character`,
    kind: 'escape',
    parsed: true,
    quantifiable: true,
  };
}

/* ------------------------------------------------------------------ */
/* Группы                                                              */
/* ------------------------------------------------------------------ */

interface GroupOpen {
  len: number;
  openDescription: string;
  closeDescription: string;
  parsed: boolean;
  capturing: boolean;
}

function readGroupOpen(p: string, i: number, nextCapture: number): GroupOpen {
  const rest = p.slice(i);

  if (p[i + 1] !== '?') {
    return {
      len: 1,
      openDescription: `Start of capturing group ${nextCapture} — what it matches is saved`,
      closeDescription: `End of capturing group ${nextCapture}`,
      parsed: true,
      capturing: true,
    };
  }

  if (rest.startsWith('(?:')) {
    return {
      len: 3,
      openDescription: 'Start of a non-capturing group — it groups the parts together but saves nothing',
      closeDescription: 'End of the non-capturing group',
      parsed: true,
      capturing: false,
    };
  }
  if (rest.startsWith('(?=')) {
    return {
      len: 3,
      openDescription: 'Start of a lookahead — what follows must match here, but is not consumed',
      closeDescription: 'End of the lookahead',
      parsed: true,
      capturing: false,
    };
  }
  if (rest.startsWith('(?!')) {
    return {
      len: 3,
      openDescription: 'Start of a negative lookahead — what follows must NOT match here',
      closeDescription: 'End of the negative lookahead',
      parsed: true,
      capturing: false,
    };
  }
  if (rest.startsWith('(?<=')) {
    return {
      len: 4,
      openDescription: 'Start of a lookbehind — the text just before must match, but is not consumed',
      closeDescription: 'End of the lookbehind',
      parsed: true,
      capturing: false,
    };
  }
  if (rest.startsWith('(?<!')) {
    return {
      len: 4,
      openDescription: 'Start of a negative lookbehind — the text just before must NOT match',
      closeDescription: 'End of the negative lookbehind',
      parsed: true,
      capturing: false,
    };
  }

  const named = /^\(\?<([A-Za-z_$][A-Za-z0-9_$]*)>/.exec(rest);
  if (named) {
    return {
      len: named[0].length,
      openDescription: `Start of capturing group ${nextCapture}, named "${named[1]}"`,
      closeDescription: `End of capturing group ${nextCapture}, named "${named[1]}"`,
      parsed: true,
      capturing: true,
    };
  }

  return {
    len: 2,
    openDescription: 'Not parsed — unknown group syntax after "(?"; JavaScript has no such construct',
    closeDescription: 'End of the group that was not parsed',
    parsed: false,
    capturing: false,
  };
}

/* ------------------------------------------------------------------ */
/* Основной разбор                                                     */
/* ------------------------------------------------------------------ */

/**
 * Разбирает паттерн в список подписанных кусочков.
 *
 * flags влияют на смысл: `m` меняет ^ и $ с границ строки на границы строки
 * текста, `s` разрешает точке совпадать с переводом строки, `u` включает
 * \p{...} и \u{...}. Поэтому флаги — параметр, а не догадка.
 */
export function explainPattern(pattern: string, flags = ''): ExplanationPart[] {
  const groups = scanGroups(pattern);
  const ctx: Ctx = {
    multiline: flags.includes('m'),
    dotAll: flags.includes('s'),
    unicode: flags.includes('u') || flags.includes('v'),
    groupCount: groups.count,
    groupNames: groups.names,
  };

  const out: ExplanationPart[] = [];
  const stack: { closeDescription: string; partIndex: number }[] = [];
  let i = 0;
  let nextCapture = 1;
  /** можно ли поставить квантификатор прямо сейчас (был ли слева атом) */
  let quantifiable = false;

  /** Приклеивает квантификатор к только что добавленному атому, если он есть. */
  const attachQuantifier = (part: ExplanationPart): void => {
    const q = readQuantifier(pattern, i);
    if (!q) { out.push(part); return; }
    if (q.max !== null && q.max < q.min) {
      out.push(part);
      out.push(unparsedPart(q.raw, `in "${q.raw}" the upper bound is smaller than the lower bound, so this pattern will not compile`, stack.length));
      i += q.raw.length;
      return;
    }
    part.token += q.raw;
    part.description += ` — ${quantifierPhrase(q)}`;
    part.quantifier = q;
    i += q.raw.length;
    out.push(part);
  };

  while (i < pattern.length) {
    const before = i;
    const c = pattern[i];
    const depth = stack.length;

    /* --- квантификатор без атома слева --------------------------- */
    const loneQ = (c === '*' || c === '+' || c === '?' || c === '{') ? readQuantifier(pattern, i) : null;
    if (loneQ && !quantifiable) {
      // Полностью оформленный квантификатор без атома слева — ошибка движка,
      // включая фигурные скобки: /^{2}$/ не компилируется («Nothing to repeat»).
      // А вот `{` без корректного тела сюда не попадёт: readQuantifier вернёт
      // null, и `{` уедет в обычный текст, как того и хочет движок (/a{/ валиден).
      out.push(unparsedPart(loneQ.raw, `the quantifier "${loneQ.raw}" has nothing to repeat, so this pattern will not compile`, depth));
      i += loneQ.raw.length;
      quantifiable = false;
      continue;
    }

    /* --- группы --------------------------------------------------- */
    if (c === '(') {
      const g = readGroupOpen(pattern, i, nextCapture);
      const part: ExplanationPart = {
        token: pattern.slice(i, i + g.len),
        description: g.openDescription,
        parsed: g.parsed,
        kind: g.parsed ? 'group-open' : 'unparsed',
        depth,
      };
      out.push(part);
      stack.push({ closeDescription: g.closeDescription, partIndex: out.length - 1 });
      if (g.capturing) nextCapture += 1;
      i += g.len;
      quantifiable = false;
      continue;
    }

    if (c === ')') {
      const open = stack.pop();
      if (!open) {
        // Одиночная `)` — синтаксическая ошибка движка («Unmatched ')'»).
        out.push(unparsedPart(')', 'a closing ")" with no matching "(", so this pattern will not compile', depth));
        i += 1;
        quantifiable = false;
        continue;
      }
      out.push({ token: ')', description: open.closeDescription, parsed: true, kind: 'group-close', depth: stack.length });
      i += 1;
      // Квантификатор после `)` относится ко всей группе, а не к одному символу,
      // поэтому он идёт отдельной подписью, а не приклеивается к скобке.
      const q = readQuantifier(pattern, i);
      if (q) {
        if (q.max !== null && q.max < q.min) {
          out.push(unparsedPart(q.raw, `in "${q.raw}" the upper bound is smaller than the lower bound, so this pattern will not compile`, stack.length));
        } else {
          out.push({
            token: q.raw,
            description: `The group above is repeated — ${quantifierPhrase(q)}`,
            parsed: true,
            kind: 'quantifier',
            depth: stack.length,
            quantifier: q,
          });
        }
        i += q.raw.length;
      }
      quantifiable = true;
      continue;
    }

    /* --- альтернатива --------------------------------------------- */
    if (c === '|') {
      out.push({
        token: '|',
        description: depth > 0
          ? 'Alternation — either everything to the left inside this group, or everything to the right'
          : 'Alternation — either the whole expression to the left, or the whole expression to the right',
        parsed: true,
        kind: 'alternation',
        depth,
      });
      i += 1;
      quantifiable = false;
      continue;
    }

    /* --- якоря ----------------------------------------------------- */
    if (c === '^' || c === '$') {
      const isStart = c === '^';
      let description: string;
      if (ctx.multiline) {
        description = isStart
          ? 'Start of a line — the m flag is on, so this also matches right after a line break'
          : 'End of a line — the m flag is on, so this also matches right before a line break';
      } else {
        description = isStart
          ? 'Start of the string — add the m flag to make it match at the start of every line'
          : 'End of the string — add the m flag to make it match at the end of every line';
      }
      out.push({ token: c, description, parsed: true, kind: 'anchor', depth });
      i += 1;
      // Якорь квантифицировать нельзя: /^*/ не компилируется.
      quantifiable = false;
      continue;
    }

    /* --- точка ----------------------------------------------------- */
    if (c === '.') {
      i += 1;
      attachQuantifier({
        token: '.',
        description: ctx.dotAll
          ? 'Any character, including line breaks — the s flag is on'
          : 'Any character except a line break — add the s flag to include line breaks',
        parsed: true,
        kind: 'dot',
        depth,
      });
      quantifiable = true;
      continue;
    }

    /* --- наборы ---------------------------------------------------- */
    if (c === '[') {
      const cls = parseCharClass(pattern, i);
      const raw = pattern.slice(i, i + cls.len);
      if (cls.error) {
        out.push(unparsedPart(raw, cls.error, depth));
        i += cls.len;
        quantifiable = false;
        continue;
      }
      i += cls.len;
      attachQuantifier({
        token: raw,
        description: describeCharSet(cls.negated, cls.items),
        parsed: true,
        kind: 'set',
        depth,
        charSet: { negated: cls.negated, items: cls.items },
      });
      quantifiable = true;
      continue;
    }

    /* --- экранированное -------------------------------------------- */
    if (c === '\\') {
      const esc = readEscape(pattern, i, ctx);
      const token = pattern.slice(i, i + esc.len);
      i += esc.len;
      const part: ExplanationPart = {
        token,
        description: esc.description,
        parsed: esc.parsed,
        kind: esc.kind,
        depth,
      };
      if (esc.quantifiable) attachQuantifier(part);
      else out.push(part);
      quantifiable = esc.quantifiable;
      continue;
    }

    /* --- обычный текст --------------------------------------------- */
    let end = i;
    while (
      end < pattern.length &&
      !SYNTAX_CHARS.has(pattern[end]) &&
      !(pattern[end] === '{' && readQuantifier(pattern, end) !== null)
    ) {
      end += 1;
    }

    if (end === i) {
      // Сюда попасть не должны, но если попали — двигаемся и честно признаёмся,
      // иначе цикл зациклится и панель просто зависнет.
      out.push(unparsedPart(c, 'this character was not recognised', depth));
      i += 1;
      quantifiable = false;
      continue;
    }

    // Квантификатор относится только к ПОСЛЕДНЕМУ символу пробега: в `abc+`
    // повторяется "c", а не "abc". Поэтому последний символ отделяем.
    const quantifierFollows = end < pattern.length && readQuantifier(pattern, end) !== null;
    if (quantifierFollows && end - i > 1) end -= 1;

    const text = pattern.slice(i, end);
    i = end;
    attachQuantifier({
      token: text,
      description: text.length === 1 ? `Literal ${showChar(text)}` : `The literal text "${text}"`,
      parsed: true,
      kind: 'literal',
      depth,
    });
    quantifiable = true;

    if (i === before) break; // страховка от зацикливания
  }

  // Незакрытые группы — это несобираемый паттерн. Молча оставить их
  // «начало группы N» значило бы утверждать, что всё в порядке.
  for (const open of stack) {
    const part = out[open.partIndex];
    part.parsed = false;
    part.kind = 'unparsed';
    part.description = 'Not parsed — this group is never closed with ")", so this pattern will not compile';
  }

  return out;
}

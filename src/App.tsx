import { useState, useMemo } from 'react';
import { extractMatches, explainPattern, CHEAT_SHEET } from './utils/regex-utils';

// The page opens on a worked example, not an empty form: the first thing a
// visitor sees is what the tool does. Clearing it is one tap.
const EXAMPLE_PATTERN = '(\\w+)@(\\w+)\\.(\\w+)';
const EXAMPLE_TEXT = 'write to ann@example.com or bob@test.org';

function App() {
  const [pattern, setPattern] = useState(EXAMPLE_PATTERN);
  const [flags, setFlags] = useState('g');
  const [testStr, setTestStr] = useState(EXAMPLE_TEXT);
  const [showCheat, setShowCheat] = useState(false);
  const isExample = pattern === EXAMPLE_PATTERN && testStr === EXAMPLE_TEXT;

  const result = useMemo(() => extractMatches(pattern, flags, testStr), [pattern, flags, testStr]);
  // Флаги передаются в разбор не для красоты: m меняет смысл ^ и $, s — смысл
  // точки, u включает \p{...}. Без них объяснение было бы догадкой.
  const explanation = useMemo(() => pattern ? explainPattern(pattern, flags) : [], [pattern, flags]);
  const unparsedCount = useMemo(() => explanation.filter(p => !p.parsed).length, [explanation]);

  const toggleFlag = (f: string) => setFlags(prev => prev.includes(f) ? prev.replace(f, '') : prev + f);

  const highlighted = useMemo(() => {
    if (!result.isValid || result.matchCount === 0) return testStr;
    const parts: { text: string; match: boolean }[] = [];
    let last = 0;
    result.matches.forEach(m => {
      if (m.index > last) parts.push({ text: testStr.slice(last, m.index), match: false });
      parts.push({ text: m.fullMatch, match: true });
      last = m.index + m.fullMatch.length;
    });
    if (last < testStr.length) parts.push({ text: testStr.slice(last), match: false });
    return parts;
  }, [result, testStr]);

  return (
    <div className="wb">
      <header className="wb-top">
        <a className="wb-brand" href="https://alftech.space/"><i />ALFTECH</a>
        <nav>
          <button className="wb-chip" style={{ opacity: 1, minHeight: 36 }} onClick={() => setShowCheat(!showCheat)} aria-pressed={showCheat}>cheat sheet</button>
        </nav>
      </header>
      <main className="wb-main">
        <div className="wb-eyebrow">Regex tester · runs in your browser</div>
        <h1 className="wb-h1">Your pattern, <em>explained</em> as you type.</h1>
        <p className="wb-lede">Matches are highlighted in the text below, listed with their index and groups, and every token of the pattern is spelled out in plain words.</p>

        <div className="wb-stack">
          <section className="wb-slab">
            <label className="wb-label" htmlFor="pattern">Pattern {isExample && <span style={{ color: 'var(--acc)' }}>· example — type your own</span>}</label>
            <input id="pattern" type="text" value={pattern} onChange={e => setPattern(e.target.value)} placeholder="[a-z]+" spellCheck={false} autoCapitalize="off" autoCorrect="off" />
            <div className="wb-row" style={{ marginTop: 12 }}>
              <span className="wb-label" style={{ margin: 0 }}>Flags</span>
              {/* s и u влияют на разбор паттерна (точка и \p{...}), поэтому их
                  нельзя было оставлять недоступными — иначе объяснение
                  описывало бы режим, который невозможно включить. */}
              {['g', 'i', 'm', 's', 'u'].map(f => (
                <button key={f} className="wb-chip" onClick={() => toggleFlag(f)} aria-pressed={flags.includes(f)}>{f}</button>
              ))}
              {(pattern || testStr) && <button className="wb-chip" style={{ marginLeft: 'auto' }} onClick={() => { setPattern(''); setTestStr(''); }}>clear</button>}
            </div>
          </section>

          {!result.isValid && <div className="wb-error">{result.error}</div>}

          <div className="wb-grid2">
            <div>
              <label className="wb-label" htmlFor="text">Test text</label>
              <textarea id="text" className="wb-field" value={testStr} onChange={e => setTestStr(e.target.value)} rows={5} placeholder="Paste the text to search in…" spellCheck={false} />
            </div>
            <div>
              <h2 className="wb-h2">Matches <b>{result.isValid ? result.matchCount : '—'}</b></h2>
              <div className="wb-sheet wb-mono" style={{ whiteSpace: 'pre-wrap', minHeight: 120, fontSize: 15, lineHeight: 1.7, wordBreak: 'break-word' }}>
                {!testStr ? <span style={{ color: 'var(--dim)' }}>The text appears here with each match marked.</span>
                  : Array.isArray(highlighted) ? highlighted.map((p, i) => p.match
                    ? <mark key={i} style={{ background: 'var(--acc)', color: 'var(--acc-ink)', padding: '1px 0', boxShadow: '0 0 0 2px var(--acc)' }}>{p.text}</mark>
                    : <span key={i}>{p.text}</span>) : highlighted}
              </div>
            </div>
          </div>

          {result.matches.length > 0 && (
            <section>
              <h2 className="wb-h2">Each match</h2>
              <div className="wb-list">
                {result.matches.map((m, i) => (
                  <div key={i} className="wb-row" style={{ gap: '6px 14px' }}>
                    <span className="wb-mono" style={{ color: 'var(--dim)', fontSize: 12, minWidth: 28 }}>#{i + 1}</span>
                    <span className="wb-tag">{m.fullMatch === '' ? '∅ empty' : m.fullMatch}</span>
                    <span className="wb-mono" style={{ fontSize: 12, color: 'var(--soft)' }}>index {m.index}</span>
                    {m.groups.length > 0 && <span className="wb-row" style={{ gap: 6 }}>{m.groups.map((g, j) => (
                      <span key={j} className="wb-mono" style={{ fontSize: 13, border: '1px solid var(--line)', padding: '1px 6px', background: 'var(--sheet)' }}>
                        <span style={{ color: 'var(--dim)' }}>${j + 1} </span>{g ?? 'undefined'}
                      </span>))}</span>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {explanation.length > 0 && (
            <section>
              <h2 className="wb-h2">
                The pattern, piece by piece
                {unparsedCount > 0 && <span style={{ color: 'var(--warn)', textTransform: 'none' }}>— {unparsedCount} part{unparsedCount === 1 ? '' : 's'} could not be parsed</span>}
              </h2>
              {/* Разбор знает не все правила движка: под флагом u строгость выше
                  (например, `a{` и `\q` там уже ошибки), а повтор имени группы он
                  не ловит вовсе. Если движок паттерн отверг, а придраться нам было
                  не к чему, панель обязана сказать об этом сама, а не молча
                  показывать разбор, который выглядит благополучным. */}
              {!result.isValid && unparsedCount === 0 && (
                <div className="wb-note" style={{ marginBottom: 10 }}>The engine rejects this pattern, but the breakdown below could not tell which part is at fault — read it with that in mind.</div>
              )}
              <div className="wb-list">
                {explanation.map((part, i) => (
                  <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
                    {/* Отступ показывает вложенность в группы — иначе на длинных
                        паттернах непонятно, к чему относится альтернатива. */}
                    <span className="wb-tag" style={{ marginLeft: `${part.depth * 0.9}rem`, flexShrink: 0, ...(part.parsed ? {} : { background: '#fff4da', color: 'var(--warn)' }) }}>{part.token}</span>
                    <span style={{ fontSize: 14, color: part.parsed ? '#22323f' : 'var(--warn)' }}>{part.description}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {showCheat && (
            <section>
              <h2 className="wb-h2">Cheat sheet</h2>
              <div style={{ display: 'grid', gap: '0 28px', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                {CHEAT_SHEET.map(cat => (
                  <div key={cat.category} className="wb-list" style={{ marginBottom: 22 }}>
                    <div className="wb-label" style={{ paddingTop: 10 }}>{cat.category}</div>
                    {cat.items.map(item => (
                      <div key={item.token} style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                        <button className="wb-tag" style={{ border: 0, cursor: 'pointer' }} title="Add to the pattern" onClick={() => setPattern(p => p + item.token)}>{item.token}</button>
                        <span style={{ fontSize: 13, color: 'var(--soft)' }}>{item.description}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;

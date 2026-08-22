import { useState, useMemo } from 'react';
import { extractMatches, explainPattern, CHEAT_SHEET } from './utils/regex-utils';

function App() {
  const [pattern, setPattern] = useState('');
  const [flags, setFlags] = useState('g');
  const [testStr, setTestStr] = useState('');
  const [showCheat, setShowCheat] = useState(false);

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
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 p-4">
        <div className="mx-auto max-w-5xl flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-orange-400 to-red-400 bg-clip-text text-transparent">Regex Tester</h1>
          <button onClick={() => setShowCheat(!showCheat)} className="bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg text-sm">{showCheat ? 'Hide' : 'Show'} Cheat Sheet</button>
        </div>
      </header>
      <div className="mx-auto max-w-5xl p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Pattern</label>
            <input type="text" value={pattern} onChange={e => setPattern(e.target.value)} placeholder="[a-z]+" className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono placeholder-gray-600 focus:outline-none focus:border-orange-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Flags</label>
            <div className="flex gap-2">
              {/* s и u влияют на разбор паттерна (точка и \p{...}), поэтому их
                  нельзя было оставлять недоступными — иначе объяснение
                  описывало бы режим, который невозможно включить. */}
              {['g', 'i', 'm', 's', 'u'].map(f => (
                <button key={f} onClick={() => toggleFlag(f)} aria-pressed={flags.includes(f)}
                  className={`px-3 py-2 min-w-11 md:min-w-0 rounded-lg text-sm font-mono font-bold ${flags.includes(f) ? 'bg-orange-600' : 'bg-gray-800'}`}>{f}</button>
              ))}
            </div>
          </div>
        </div>
        {!result.isValid && <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 text-red-400 text-sm">{result.error}</div>}
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-1">Test String</label>
          <textarea value={testStr} onChange={e => setTestStr(e.target.value)} rows={5} placeholder="Enter text to test..." className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono placeholder-gray-600 focus:outline-none focus:border-orange-500 resize-none" />
        </div>
        {testStr && result.isValid && (
          <div>
            <h2 className="text-sm font-medium text-gray-400 mb-2">Highlighted Matches ({result.matchCount})</h2>
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 font-mono text-sm whitespace-pre-wrap">
              {Array.isArray(highlighted) ? highlighted.map((p, i) => p.match ? <mark key={i} className="bg-orange-500/30 text-orange-300 rounded px-0.5">{p.text}</mark> : <span key={i}>{p.text}</span>) : highlighted}
            </div>
          </div>
        )}
        {result.matches.length > 0 && (
          <div>
            <h2 className="text-sm font-medium text-gray-400 mb-2">Match Details</h2>
            <div className="space-y-2">
              {result.matches.map((m, i) => (
                <div key={i} className="bg-gray-900 border border-gray-800 rounded-lg p-3 text-sm">
                  <span className="text-orange-400 font-mono">"{m.fullMatch}"</span>
                  <span className="text-gray-500 ml-2">at index {m.index}</span>
                  {m.groups.length > 0 && <div className="mt-1 text-gray-400">Groups: {m.groups.map((g, j) => <span key={j} className="text-blue-400 font-mono ml-1">{g}</span>)}</div>}
                </div>
              ))}
            </div>
          </div>
        )}
        {explanation.length > 0 && (
          <div>
            <h2 className="text-sm font-medium text-gray-400 mb-2">
              Pattern Explanation
              {unparsedCount > 0 && (
                <span className="ml-2 text-amber-400 font-normal">
                  — {unparsedCount} part{unparsedCount === 1 ? '' : 's'} could not be parsed
                </span>
              )}
            </h2>
            {/* Разбор знает не все правила движка: под флагом u строгость выше
                (например, `a{` и `\q` там уже ошибки), а повтор имени группы он
                не ловит вовсе. Если движок паттерн отверг, а придраться нам было
                не к чему, панель обязана сказать об этом сама, а не молча
                показывать разбор, который выглядит благополучным. */}
            {!result.isValid && unparsedCount === 0 && (
              <div className="mb-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                The engine rejects this pattern, but the breakdown below could not tell which part is at fault — read it with that in mind.
              </div>
            )}
            <div className="bg-gray-900 border border-gray-800 rounded-lg divide-y divide-gray-800">
              {explanation.map((part, i) => (
                <div key={i} className="flex gap-3 px-4 py-2 items-baseline">
                  {/* Отступ показывает вложенность в группы — иначе на длинных
                      паттернах непонятно, к чему относится альтернатива. */}
                  <span style={{ marginLeft: `${part.depth * 0.9}rem` }}
                        className={`font-mono text-sm shrink-0 rounded px-1.5 py-0.5 ${part.parsed ? 'bg-gray-800 text-orange-400' : 'bg-amber-500/15 text-amber-400'}`}>
                    {part.token}
                  </span>
                  <span className={`text-xs ${part.parsed ? 'text-gray-400' : 'text-amber-400'}`}>
                    {part.description}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {showCheat && (
          <div>
            <h2 className="text-sm font-medium text-gray-400 mb-2">Cheat Sheet</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {CHEAT_SHEET.map(cat => (
                <div key={cat.category} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                  <h3 className="text-orange-400 font-medium mb-2">{cat.category}</h3>
                  <div className="space-y-2">
                    {cat.items.map(item => (
                      <div key={item.token} className="text-sm">
                        <span className="font-mono text-white bg-gray-800 rounded px-1.5 py-0.5">{item.token}</span>
                        <div className="text-gray-400 text-xs mt-1">{item.description}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;

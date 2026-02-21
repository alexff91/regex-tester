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

interface ExplanationPart { token: string; description: string; }

export function explainPattern(p: string): ExplanationPart[] {
  const r: ExplanationPart[] = [];
  let i = 0;
  while (i < p.length) {
    const c = p[i];
    if (c === '^') { r.push({token:'^',description:'Start'}); i++; }
    else if (c === '.') { r.push({token:'.',description:'Any char'}); i++; }
    else if (c === '*') { r.push({token:'*',description:'0+'}); i++; }
    else if (c === '+') { r.push({token:'+',description:'1+'}); i++; }
    else if (c === '?') { r.push({token:'?',description:'0/1'}); i++; }
    else if (c === '|') { r.push({token:'|',description:'OR'}); i++; }
    else { r.push({token:c,description:'Literal '+c}); i++; }
  }
  return r;
}

export const CHEAT_SHEET = [{category:"Anchors",items:[{token:"^",description:"Start"}]},{category:"Flags",items:[{token:"g",description:"Global"}]}];

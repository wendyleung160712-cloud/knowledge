import type { VocabItem } from '../types';

/** Prefer British English; rate slightly slow for kids. */
let cachedVoice: SpeechSynthesisVoice | null | undefined;

function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return cachedVoice ?? null;
  const preferred =
    voices.find((v) => /en-GB/i.test(v.lang) && /female|samantha|serena|google|karen|susan|martha/i.test(v.name)) ||
    voices.find((v) => /en-GB/i.test(v.lang)) ||
    voices.find((v) => /^en/i.test(v.lang) && /female|samantha|google/i.test(v.name)) ||
    voices.find((v) => /^en/i.test(v.lang));
  cachedVoice = preferred || null;
  return cachedVoice;
}

/** Warm voices list; call once on app mount. */
export function initSpeechVoices(): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  pickVoice();
  window.speechSynthesis.onvoiceschanged = () => {
    cachedVoice = undefined;
    pickVoice();
  };
}

const ABBREV: Record<string, string> = {
  mr: 'Mister',
  mrs: 'Missus',
  ms: 'Miz',
  miss: 'Miss',
  ok: 'okay',
  st: 'Saint',
};

/** Strip display markup so TTS does not read parentheses / ellipsis oddly. */
export function cleanSpeakText(word: string): string {
  let s = word.trim();
  s = s.replace(/\s*\([^)]*\)\s*/g, ' ');
  s = s.replace(/\u2026/g, '...');
  s = s.replace(/\s*\.\.\.\s*/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  const parts = s.split(' ');
  const out = parts.map((tok) => {
    const punct = tok.match(/[.?!,]+$/)?.[0] || '';
    const bare = tok.replace(/[.?!,]+$/g, '');
    const key = bare.toLowerCase();
    if (ABBREV[key]) return ABBREV[key] + punct;
    return tok;
  });
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

export function speakTextFor(item: Pick<VocabItem, 'word' | 'speak'>): string {
  if (item.speak && item.speak.trim()) return item.speak.trim();
  return cleanSpeakText(item.word);
}

let resumeTimer: number | null = null;

function keepSpeechAlive(on: boolean): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  if (on) {
    if (resumeTimer != null) return;
    resumeTimer = window.setInterval(() => {
      try {
        if (window.speechSynthesis.speaking) window.speechSynthesis.resume();
      } catch {
        /* iOS can throw if the utterance already ended */
      }
    }, 250);
  } else if (resumeTimer != null) {
    window.clearInterval(resumeTimer);
    resumeTimer = null;
  }
}

export function speakEnglish(text: string, times = 1, gapMs = 480): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  const clean = text.trim();
  if (!clean) return;
  window.speechSynthesis.cancel();
  keepSpeechAlive(false);
  const preferred = pickVoice();
  let left = Math.max(1, times);
  const playOnce = () => {
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'en-GB';
    u.rate = 0.82;
    u.pitch = 1;
    if (preferred) u.voice = preferred;
    u.onend = () => {
      left -= 1;
      if (left > 0) window.setTimeout(playOnce, gapMs);
      else keepSpeechAlive(false);
    };
    u.onerror = () => keepSpeechAlive(false);
    keepSpeechAlive(true);
    window.speechSynthesis.speak(u);
  };
  // iOS often drops or stutters the first utterance if it starts immediately after cancel
  window.setTimeout(playOnce, 80);
}

export function speakItem(item: Pick<VocabItem, 'word' | 'speak'>, times = 1): void {
  speakEnglish(speakTextFor(item), times);
}

export function stopSpeak(): void {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
  keepSpeechAlive(false);
}

export function normalizeSpell(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/\s*\.\.\.\s*/g, ' ... ')
    .replace(/\s*\u2026\s*/g, ' ... ');
}

export function spellMatches(input: string, answer: string): boolean {
  const a = normalizeSpell(input);
  const b = normalizeSpell(answer);
  if (a === b) return true;
  const soft = (x: string) =>
    x
      .replace(/\bsomebody\b/g, 'sb')
      .replace(/\bsomeone\b/g, 'sb')
      .replace(/\bsomething\b/g, 'sth')
      .replace(/\bdo something\b/g, 'do sth');
  if (soft(a) === soft(b)) return true;
  // ignore trailing ? . !
  const strip = (x: string) => soft(x).replace(/[.?!,]+$/g, '').trim();
  return strip(a) === strip(b);
}

/** Acceptable spellings for gate checks (display word still canonical). */
export function spellAcceptAnswers(item: Pick<VocabItem, 'word'>): string[] {
  const set = new Set<string>();
  const add = (x: string) => {
    const n = normalizeSpell(x);
    if (n) set.add(n);
  };
  add(item.word);
  add(item.word.replace(/[.?!,]+$/g, ''));
  const m = item.word.match(/^(.+?)\s*\(([^)]+)\)\s*(.*)$/);
  if (m) {
    const head = m[1].trim();
    const tail = m[3].trim();
    if (head) add(head);
    for (const part of m[2].split(/[/|,]/)) {
      const p = part.trim();
      if (p) add(p);
      if (head && p) add(`${head} ${p}`);
    }
    if (head && tail) add(`${head} ${tail}`);
  }
  // ellipsis forms: "get ... ready for" ↔ "get ready for"
  if (/\.\.\.|…/.test(item.word)) {
    add(item.word.replace(/\s*\.\.\.\s*/g, ' ').replace(/\s*…\s*/g, ' '));
  }
  return [...set];
}

export function spellMatchesItem(input: string, item: Pick<VocabItem, 'word'>): boolean {
  return spellAcceptAnswers(item).some((ans) => spellMatches(input, ans));
}

interface Recognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
}

export function createRecognizer(): Recognizer | null {
  const host = window as unknown as {
    SpeechRecognition?: new () => Recognizer;
    webkitSpeechRecognition?: new () => Recognizer;
  };
  const Ctor = host.SpeechRecognition || host.webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = 'en-US';
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 5;
  return rec;
}

export function speechSupported(): boolean {
  const host = window as unknown as {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };
  return !!(host.SpeechRecognition || host.webkitSpeechRecognition);
}

export function heardFromEvent(event: Event): string[] {
  const results = (
    event as unknown as {
      results: ArrayLike<{ length: number; [i: number]: { transcript: string } }>;
    }
  ).results;
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < results.length; i += 1) {
    const r = results[i];
    for (let j = 0; j < r.length; j += 1) {
      const t = r[j]?.transcript?.trim();
      if (t && !seen.has(t.toLowerCase())) {
        seen.add(t.toLowerCase());
        out.push(t);
      }
    }
  }
  return out;
}

const WORD_TO_NUM: Record<string, string> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
};

const NUM_TO_WORD: Record<string, string> = Object.fromEntries(
  Object.entries(WORD_TO_NUM).map(([w, n]) => [n, w]),
);

const SPELL_VARIANTS: [string, string][] = [
  ['colour', 'color'],
  ['coloured', 'colored'],
  ['favourite', 'favorite'],
  ['centre', 'center'],
  ['metre', 'meter'],
  ['practise', 'practice'],
  ['neighbour', 'neighbor'],
  ['organise', 'organize'],
  ['organised', 'organized'],
  ['realise', 'realize'],
  ['travelling', 'traveling'],
  ['grey', 'gray'],
];

const HOMOPHONES: Record<string, string[]> = {
  to: ['too', 'two'],
  too: ['to', 'two'],
  two: ['to', 'too'],
  for: ['four', 'fore'],
  four: ['for', 'fore'],
  one: ['won'],
  won: ['one'],
  sun: ['son'],
  son: ['sun'],
  see: ['sea', 'c'],
  sea: ['see', 'c'],
  know: ['no'],
  no: ['know'],
  write: ['right', 'rite'],
  right: ['write', 'rite'],
  their: ['there', 'theyre', "they're"],
  there: ['their', 'theyre', "they're"],
  here: ['hear'],
  hear: ['here'],
  by: ['bye', 'buy'],
  bye: ['by', 'buy'],
  buy: ['by', 'bye'],
  our: ['hour'],
  hour: ['our'],
  where: ['wear', 'ware'],
  wear: ['where', 'ware'],
  week: ['weak'],
  weak: ['week'],
  which: ['witch'],
  be: ['bee'],
  bee: ['be'],
  i: ['eye', 'aye'],
  eye: ['i', 'aye'],
  you: ['u'],
  new: ['knew'],
  knew: ['new'],
  read: ['red'],
  red: ['read'],
  meet: ['meat'],
  meat: ['meet'],
  peace: ['piece'],
  piece: ['peace'],
  whole: ['hole'],
  hole: ['whole'],
  wait: ['weight'],
  weight: ['wait'],
  hi: ['high'],
  high: ['hi'],
  ok: ['okay'],
  okay: ['ok'],
  plane: ['plain'],
  plain: ['plane'],
  sail: ['sale'],
  sale: ['sail'],
  male: ['mail'],
  mail: ['male'],
  flour: ['flower'],
  flower: ['flour'],
  break: ['brake'],
  brake: ['break'],
  weather: ['whether'],
  whether: ['weather'],
};

function foldSpeech(s: string): string {
  let x = normalizeSpell(s).toLowerCase();
  x = x.replace(/[\u3400-\u9fff]/g, ' ');
  const reps: [RegExp, string][] = [
    [/\bwhat's\b/g, 'what is'],
    [/\bi'm\b/g, 'i am'],
    [/\byou're\b/g, 'you are'],
    [/\bthey're\b/g, 'they are'],
    [/\bwe're\b/g, 'we are'],
    [/\bit's\b/g, 'it is'],
    [/\bthat's\b/g, 'that is'],
    [/\blet's\b/g, 'let us'],
    [/\bdon't\b/g, 'do not'],
    [/\bdoesn't\b/g, 'does not'],
    [/\bdidn't\b/g, 'did not'],
    [/\bcan't\b/g, 'cannot'],
    [/\bwon't\b/g, 'will not'],
    [/\bisn't\b/g, 'is not'],
    [/\baren't\b/g, 'are not'],
    [/\bwasn't\b/g, 'was not'],
    [/\bweren't\b/g, 'were not'],
    [/\bhaven't\b/g, 'have not'],
    [/\bhasn't\b/g, 'has not'],
    [/\bhadn't\b/g, 'had not'],
    [/\bcouldn't\b/g, 'could not'],
    [/\bwouldn't\b/g, 'would not'],
    [/\bshouldn't\b/g, 'should not'],
    [/\bi'd\b/g, 'i would'],
  ];
  for (const [re, to] of reps) x = x.replace(re, to);
  return x.replace(/[^a-z0-9\s']/g, ' ').replace(/\s+/g, ' ').trim();
}

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 99;
  const prev = new Array<number>(n + 1);
  const cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    cur[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j += 1) prev[j] = cur[j];
  }
  return prev[n];
}

function variantsOf(word: string): Set<string> {
  const out = new Set<string>([word]);
  if (WORD_TO_NUM[word]) out.add(WORD_TO_NUM[word]);
  if (NUM_TO_WORD[word]) out.add(NUM_TO_WORD[word]);
  for (const [a, b] of SPELL_VARIANTS) {
    if (word === a) out.add(b);
    if (word === b) out.add(a);
  }
  const homo = HOMOPHONES[word];
  if (homo) {
    for (const h of homo) out.add(h);
  }
  return out;
}

function tokenClose(heard: string, target: string): boolean {
  if (heard === target) return true;
  const ev = variantsOf(target);
  const eh = variantsOf(heard);
  for (const v of ev) {
    if (eh.has(v) || heard === v) return true;
  }
  const allow = target.length >= 8 ? 2 : target.length >= 4 ? 1 : 0;
  if (allow && editDistance(heard, target) <= allow) return true;
  for (const v of ev) {
    const a = v.length >= 8 ? 2 : v.length >= 4 ? 1 : 0;
    if (a && editDistance(heard, v) <= a) return true;
  }
  return false;
}

const FILLERS = new Set(['uh', 'um', 'er', 'ah', 'hmm', 'mm']);

export function speechLooseMatch(heard: string, target: string): boolean {
  const h = foldSpeech(heard);
  const t = foldSpeech(target);
  if (!h || !t) return false;
  if (h === t) return true;
  const hCompact = h.replace(/\s+/g, '');
  const tCompact = t.replace(/\s+/g, '');
  if (hCompact === tCompact) return true;
  if (h.includes(t) || t.includes(h)) return true;

  const tw = t.split(' ').filter(Boolean);
  const hw = h.split(' ').filter((w) => w && !FILLERS.has(w) && (tw.includes(w) || !['a', 'an', 'the'].includes(w)));
  if (!hw.length) return false;
  if (hw.join(' ') === tw.join(' ') || hw.join('') === tCompact) return true;

  if (tw.length === 1) {
    return hw.some((w) => tokenClose(w, tw[0])) || tokenClose(hCompact, tw[0]);
  }
  const hit = tw.filter((w) => hw.some((x) => tokenClose(x, w))).length;
  return hit >= Math.ceil(tw.length * 0.6);
}

/** All strings that count as a correct oral reading. */
export function acceptSpeakAnswers(item: Pick<VocabItem, 'word' | 'speak'>): string[] {
  const set = new Set<string>();
  const add = (x: string) => {
    const n = normalizeSpell(x).replace(/[^a-z0-9\s']/g, '').trim();
    if (n) set.add(n);
  };
  add(item.word);
  add(speakTextFor(item));
  add(cleanSpeakText(item.word));
  const m = item.word.match(/\(([^)]+)\)/);
  if (m) {
    for (const part of m[1].split(/[/|,]/)) add(part);
  }
  if (/\.\.\.|…/.test(item.word)) {
    add(item.word.replace(/\s*\.\.\.\s*/g, ' ').replace(/\s*…\s*/g, ' '));
  }
  return [...set];
}

export function speechMatchesItem(heard: string, item: Pick<VocabItem, 'word' | 'speak'>): boolean {
  if (!heard.trim()) return false;
  return acceptSpeakAnswers(item).some((t) => speechLooseMatch(heard, t));
}

export function looksLikeChineseTranscript(s: string): boolean {
  const cjk = (s.match(/[\u3400-\u9fff]/g) || []).length;
  const latin = (s.match(/[a-zA-Z]/g) || []).length;
  return cjk >= 2 && cjk > latin;
}

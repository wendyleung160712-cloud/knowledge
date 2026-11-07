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

export function speakEnglish(text: string, times = 1, gapMs = 480): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  const clean = text.trim();
  if (!clean) return;
  window.speechSynthesis.cancel();
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
    };
    window.speechSynthesis.speak(u);
  };
  // Some browsers need a tick after voiceschanged
  if (!window.speechSynthesis.getVoices().length) {
    window.setTimeout(playOnce, 60);
  } else {
    playOnce();
  }
}

export function speakItem(item: Pick<VocabItem, 'word' | 'speak'>, times = 1): void {
  speakEnglish(speakTextFor(item), times);
}

export function stopSpeak(): void {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
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
  for (let i = 0; i < results.length; i += 1) {
    const r = results[i];
    for (let j = 0; j < r.length; j += 1) {
      const t = r[j]?.transcript?.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

export function speechLooseMatch(heard: string, target: string): boolean {
  const h = normalizeSpell(heard).replace(/[^a-z0-9\s']/g, '');
  const t = normalizeSpell(target).replace(/[^a-z0-9\s']/g, '');
  if (!h || !t) return false;
  if (h === t) return true;
  if (h.includes(t) || t.includes(h)) return true;
  const hw = h.split(' ').filter(Boolean);
  const tw = t.split(' ').filter(Boolean);
  if (tw.length === 1)
    return hw.some((w) => w === tw[0] || (tw[0].length > 3 && w.startsWith(tw[0].slice(0, 3))));
  const hit = tw.filter((w) => hw.includes(w)).length;
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

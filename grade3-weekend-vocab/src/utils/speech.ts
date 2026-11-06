export function speakEnglish(text: string, times = 1, gapMs = 450): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const voices = window.speechSynthesis.getVoices();
  const preferred =
    voices.find((v) => /en-GB/i.test(v.lang) && /female|samantha|serena|google/i.test(v.name)) ||
    voices.find((v) => /^en/i.test(v.lang));

  let left = Math.max(1, times);
  const playOnce = () => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-GB';
    u.rate = 0.88;
    if (preferred) u.voice = preferred;
    u.onend = () => {
      left -= 1;
      if (left > 0) window.setTimeout(playOnce, gapMs);
    };
    window.speechSynthesis.speak(u);
  };
  playOnce();
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
    .replace(/\s*\.\.\.\s*/g, ' ... ');
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
  return soft(a) === soft(b);
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

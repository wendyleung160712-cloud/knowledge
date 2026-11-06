import type { DayPlan, ProgressState, TestGate, WordProgress } from '../types';
import { TEST_GATES } from '../types';
import { VOCAB } from '../data/vocab';

const KEY = 'gz3a_weekend_v1';

function emptyWord(): WordProgress {
  return {
    learned: false,
    pos: false,
    meaning: false,
    spell: false,
    speak: false,
    wrongCount: 0,
  };
}

export function defaultProgress(): ProgressState {
  const words: Record<string, WordProgress> = {};
  for (const w of VOCAB) words[w.id] = emptyWord();
  return {
    version: 1,
    day: 1,
    unitFilter: 0,
    words,
    wrongIds: [],
    updatedAt: Date.now(),
  };
}

export function loadProgress(): ProgressState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ProgressState;
      if (parsed?.version === 1) {
        const base = defaultProgress();
        for (const id of Object.keys(base.words)) {
          if (parsed.words?.[id]) {
            base.words[id] = { ...emptyWord(), ...parsed.words[id] };
          }
        }
        base.day = parsed.day === 2 ? 2 : 1;
        base.unitFilter = ([0, 1, 2, 3, 4] as const).includes(
          parsed.unitFilter as 0 | 1 | 2 | 3 | 4,
        )
          ? (parsed.unitFilter as 0 | 1 | 2 | 3 | 4)
          : 0;
        base.wrongIds = Array.isArray(parsed.wrongIds)
          ? parsed.wrongIds.filter((id) => id in base.words)
          : [];
        base.updatedAt = parsed.updatedAt || Date.now();
        return base;
      }
    }
  } catch {
    /* ignore */
  }
  return defaultProgress();
}

export function saveProgress(state: ProgressState): void {
  const next = { ...state, version: 1 as const, updatedAt: Date.now() };
  localStorage.setItem(KEY, JSON.stringify(next));
}

export function isLearned(p: WordProgress | undefined): boolean {
  return !!p?.learned;
}

export function isMastered(p: WordProgress | undefined): boolean {
  if (!p?.learned) return false;
  return TEST_GATES.every((g) => p[g]);
}

export function markLearned(state: ProgressState, id: string): ProgressState {
  const cur = state.words[id] || emptyWord();
  return {
    ...state,
    words: {
      ...state.words,
      [id]: { ...cur, learned: true, learnedAt: cur.learnedAt || Date.now() },
    },
  };
}

export function markTestGate(
  state: ProgressState,
  id: string,
  gate: TestGate,
  ok: boolean,
): ProgressState {
  const cur = state.words[id] || emptyWord();
  const next: WordProgress = { ...cur, [gate]: ok ? true : cur[gate] };
  let wrongIds = [...state.wrongIds];
  if (!ok) {
    next.wrongCount = cur.wrongCount + 1;
    next.lastWrongAt = Date.now();
    if (!wrongIds.includes(id)) wrongIds.push(id);
  } else if (isMastered(next)) {
    wrongIds = wrongIds.filter((x) => x !== id);
  }
  return {
    ...state,
    words: { ...state.words, [id]: next },
    wrongIds,
  };
}

export function resetProgress(): ProgressState {
  const fresh = defaultProgress();
  saveProgress(fresh);
  return fresh;
}

export function dayUnits(day: DayPlan): (1 | 2 | 3 | 4)[] {
  return day === 1 ? [1, 2] : [3, 4];
}

export function statsFor(
  state: ProgressState,
  ids: string[],
): {
  total: number;
  learned: number;
  mastered: number;
  learnedPct: number;
  masteredPct: number;
  gates: Record<TestGate, { done: number; rate: number }>;
} {
  const total = ids.length || 1;
  let learned = 0;
  let mastered = 0;
  const gates: Record<TestGate, { done: number; rate: number }> = {
    pos: { done: 0, rate: 0 },
    meaning: { done: 0, rate: 0 },
    spell: { done: 0, rate: 0 },
    speak: { done: 0, rate: 0 },
  };
  for (const id of ids) {
    const p = state.words[id] || emptyWord();
    if (p.learned) learned += 1;
    if (isMastered(p)) mastered += 1;
    for (const g of TEST_GATES) {
      if (p[g]) gates[g].done += 1;
    }
  }
  for (const g of TEST_GATES) {
    gates[g].rate = Math.round((gates[g].done / total) * 100);
  }
  return {
    total: ids.length,
    learned,
    mastered,
    learnedPct: Math.round((learned / total) * 100),
    masteredPct: Math.round((mastered / total) * 100),
    gates,
  };
}

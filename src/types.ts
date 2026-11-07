export type Pos =
  | 'n.'
  | 'v.'
  | 'adj.'
  | 'adv.'
  | 'prep.'
  | 'pron.'
  | 'conj.'
  | 'interj.'
  | 'art.'
  | 'num.'
  | 'phr.';

export interface VocabItem {
  id: string;
  word: string;
  ipa: string;
  pos: Pos;
  zh: string;
  unit: 1 | 2 | 3 | 4;
  page?: number;
  /** 课本标 *：只要求理解 */
  star?: boolean;
  /** 黑体课标词 */
  core?: boolean;
  /** TTS 专用纯英文（无括号/省略号）；缺省则自动清理 word */
  speak?: string;
}

/** 学习过程步骤（不计分） */
export type LearnStep = 'meet' | 'shadow' | 'coverZh' | 'coverEn' | 'done';

/** 测试关（计分，须已学习） */
export type TestGate = 'pos' | 'meaning' | 'spell' | 'speak';

export type DayPlan = 1 | 2;

export interface WordProgress {
  /** 已走完学习五步 */
  learned: boolean;
  pos: boolean;
  meaning: boolean;
  spell: boolean;
  speak: boolean;
  wrongCount: number;
  lastWrongAt?: number;
  learnedAt?: number;
}

export interface ProgressState {
  version: 4;
  day: DayPlan;
  unitFilter: 0 | 1 | 2 | 3 | 4;
  words: Record<string, WordProgress>;
  wrongIds: string[];
  updatedAt: number;
}

export const LEARN_STEPS: LearnStep[] = ['meet', 'shadow', 'coverZh', 'coverEn', 'done'];

export const LEARN_LABEL: Record<LearnStep, string> = {
  meet: '认识',
  shadow: '跟读',
  coverZh: '英→中',
  coverEn: '中→英',
  done: '小结',
};

export const TEST_GATES: TestGate[] = ['pos', 'meaning', 'spell', 'speak'];

export const TEST_LABEL: Record<TestGate, string> = {
  pos: '词性',
  meaning: '意思',
  spell: '拼写',
  speak: '朗读',
};

export const BATCH_SIZE = 6;
export const DAILY_SIZE = 10;

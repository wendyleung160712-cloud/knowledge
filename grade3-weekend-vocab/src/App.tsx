import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronLeft,
  ClipboardList,
  Eye,
  Mic,
  PenLine,
  RotateCcw,
  Star,
  Trophy,
  Volume2,
  X,
} from 'lucide-react';
import { UNIT_META, VOCAB, wordsForDay } from './data/vocab';
import type {
  DayPlan,
  LearnStep,
  ProgressState,
  TestGate,
  VocabItem,
} from './types';
import {
  BATCH_SIZE,
  DAILY_SIZE,
  LEARN_LABEL,
  LEARN_STEPS,
  TEST_GATES,
  TEST_LABEL,
} from './types';
import { buildChunks, memoryHook } from './utils/hints';
import {
  dayUnits,
  isLearned,
  isMastered,
  loadProgress,
  markLearned,
  markTestGate,
  resetProgress,
  saveProgress,
  statsFor,
} from './utils/progress';
import {
  createRecognizer,
  heardFromEvent,
  initSpeechVoices,
  speakItem,
  speechMatchesItem,
  speechSupported,
  spellMatchesItem,
  stopSpeak,
} from './utils/speech';

type View = 'home' | 'learn' | 'batchDone' | 'test' | 'wrong' | 'list' | 'daily';

const POS_OPTIONS = ['n.', 'v.', 'adj.', 'adv.', 'prep.', 'pron.', 'conj.', 'interj.', 'art.', 'num.', 'phr.'] as const;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickMeaningChoices(item: VocabItem, pool: VocabItem[]): string[] {
  const others = shuffle(pool.filter((x) => x.id !== item.id && x.zh !== item.zh))
    .slice(0, 3)
    .map((x) => x.zh);
  return shuffle([item.zh, ...others]);
}

function pickPosChoices(correct: string): string[] {
  const rest = POS_OPTIONS.filter((p) => p !== correct);
  return shuffle([correct, ...shuffle(rest).slice(0, 3)]);
}

function ProgressBar({ pct, color = 'bg-sky-500' }: { pct: number; color?: string }) {
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-slate-200">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

function PosBadge({ pos }: { pos: string }) {
  return (
    <span className="inline-flex rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-bold text-violet-800">
      {pos}
    </span>
  );
}

function IpaLine({ ipa, size = 'md' }: { ipa?: string; size?: 'sm' | 'md' | 'lg' }) {
  const text = (ipa && ipa.trim()) || '/…/';
  const cls =
    size === 'lg'
      ? 'mt-3 text-xl font-semibold tracking-wide text-indigo-700 sm:text-2xl'
      : size === 'md'
        ? 'mt-2 text-lg font-semibold tracking-wide text-indigo-700'
        : 'mt-1 text-sm font-semibold text-indigo-600';
  return (
    <p className={cls} lang="en" title="音标">
      {text}
    </p>
  );
}

function SpeakButton({
  item,
  times = 1,
  label,
  strong = false,
  onPlayed,
}: {
  item: VocabItem;
  times?: number;
  label: string;
  strong?: boolean;
  onPlayed?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        speakItem(item, times);
        onPlayed?.();
      }}
      className={`flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 font-extrabold ${
        strong
          ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200'
          : 'bg-indigo-50 text-indigo-900 ring-1 ring-indigo-200'
      }`}
    >
      <Volume2 className="h-5 w-5" /> {label}
    </button>
  );
}

function GateHint({ text }: { text: string }) {
  return <p className="text-center text-sm font-semibold text-rose-600">{text}</p>;
}


export default function App() {
  const [progress, setProgress] = useState<ProgressState>(() => loadProgress());
  const [view, setView] = useState<View>('home');

  // learn session
  const [batch, setBatch] = useState<VocabItem[]>([]);
  const [bi, setBi] = useState(0);
  const [learnStep, setLearnStep] = useState<LearnStep>('meet');
  const [revealZh, setRevealZh] = useState(false);
  const [revealEn, setRevealEn] = useState(false);
  const [buildMode, setBuildMode] = useState(false);
  const [bank, setBank] = useState<{ id: string; text: string; used: boolean }[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [heard, setHeard] = useState('');
  const [listening, setListening] = useState(false);

  // test session
  const [testQueue, setTestQueue] = useState<VocabItem[]>([]);
  const [ti, setTi] = useState(0);
  const [testGate, setTestGate] = useState<TestGate>('pos');
  const [feedback, setFeedback] = useState<'idle' | 'ok' | 'bad'>('idle');
  const [spellInput, setSpellInput] = useState('');
  const [meaningMode, setMeaningMode] = useState<'en2zh' | 'zh2en'>('en2zh');
  const [choices, setChoices] = useState<string[]>([]);
  const [pendingTestBatch, setPendingTestBatch] = useState<VocabItem[]>([]);
  const [dailyQueue, setDailyQueue] = useState<VocabItem[]>([]);
  const [dailyIndex, setDailyIndex] = useState(0);
  const [dailyStep, setDailyStep] = useState<'dictation' | 'check' | 'shadow'>('dictation');
  const [dailyInput, setDailyInput] = useState('');
  const [dailyFeedback, setDailyFeedback] = useState<'idle' | 'ok' | 'bad'>('idle');
  const [meetListened, setMeetListened] = useState(false);
  const [shadowPassed, setShadowPassed] = useState(false);
  const [coverSpellInput, setCoverSpellInput] = useState('');
  const [coverSpellOk, setCoverSpellOk] = useState(false);
  const [speakPassed, setSpeakPassed] = useState(false);
  const [dailyShadowPassed, setDailyShadowPassed] = useState(false);

  const recRef = useRef<ReturnType<typeof createRecognizer>>(null);
  const meetPlayed = useRef(false);
  const listenTarget = useRef<'shadow' | 'test' | 'daily' | null>(null);

  useEffect(() => {
    saveProgress(progress);
  }, [progress]);

  useEffect(() => {
    initSpeechVoices();
  }, []);

  const day = progress.day;
  const dayWords = useMemo(() => {
    let list = wordsForDay(day);
    if (progress.unitFilter) list = list.filter((w) => w.unit === progress.unitFilter);
    return list;
  }, [day, progress.unitFilter]);

  const dayIds = useMemo(() => dayWords.map((w) => w.id), [dayWords]);
  const dayStats = useMemo(() => statsFor(progress, dayIds), [progress, dayIds]);

  const unlearned = useMemo(
    () => dayWords.filter((w) => !isLearned(progress.words[w.id])),
    [dayWords, progress.words],
  );
  const learnedNotMastered = useMemo(
    () =>
      dayWords.filter(
        (w) => isLearned(progress.words[w.id]) && !isMastered(progress.words[w.id]),
      ),
    [dayWords, progress.words],
  );
  const learnedWords = useMemo(
    () => dayWords.filter((w) => isLearned(progress.words[w.id])),
    [dayWords, progress.words],
  );
  const wrongItems = useMemo(
    () => VOCAB.filter((w) => progress.wrongIds.includes(w.id)),
    [progress.wrongIds],
  );

  const current = batch[bi];
  const testWord = testQueue[ti];

  function update(next: ProgressState) {
    setProgress(next);
  }

  function pickLearnBatch(fromWrong = false): VocabItem[] {
    if (fromWrong && wrongItems.length) {
      const dayWrong = wrongItems.filter((w) => dayWords.some((d) => d.id === w.id));
      const pool = dayWrong.length ? dayWrong : wrongItems;
      return shuffle(pool).slice(0, BATCH_SIZE);
    }
    // 未学优先；* 理解词稍后；Day2 夹带一点错词
    let pool = [...unlearned];
    if (!pool.length) {
      // 已学完则允许「再学一遍」弱项
      pool = [...learnedNotMastered, ...dayWords.filter((w) => isMastered(progress.words[w.id]))];
    }
    const core = shuffle(pool.filter((w) => !w.star));
    const star = shuffle(pool.filter((w) => w.star));
    let list = [...core, ...star].slice(0, BATCH_SIZE);
    if (day === 2 && wrongItems.length) {
      const extra = wrongItems.filter((w) => !list.some((x) => x.id === w.id)).slice(0, 2);
      list = [...extra, ...list].slice(0, BATCH_SIZE);
    }
    return list.length ? list : shuffle(dayWords).slice(0, Math.min(BATCH_SIZE, dayWords.length));
  }

  function startLearn(fromWrong = false) {
    stopSpeak();
    const list = pickLearnBatch(fromWrong);
    setBatch(list);
    setBi(0);
    setLearnStep('meet');
    setRevealZh(false);
    setRevealEn(false);
    setBuildMode(false);
    setBank([]);
    setPicked([]);
    setHeard('');
    meetPlayed.current = false;
    setMeetListened(false);
    setShadowPassed(false);
    setCoverSpellInput('');
    setCoverSpellOk(false);
    setView('learn');
  }

  function startTest(items: VocabItem[]) {
    const eligible = items.filter((w) => isLearned(progress.words[w.id]));
    if (!eligible.length) {
      alert('还没有学完的词。请先点「今日学习」走完学习过程。');
      return;
    }
    stopSpeak();
    const list = shuffle(eligible);
    setTestQueue(list);
    setTi(0);
    setTestGate('pos');
    setFeedback('idle');
    setSpellInput('');
    setSpeakPassed(false);
    setHeard('');
    setChoices(pickPosChoices(list[0].pos));
    setView('test');
  }

  function pickDailyPool(): VocabItem[] {
    const byId = new Map(VOCAB.map((w) => [w.id, w]));
    const picked: VocabItem[] = [];
    const seen = new Set<string>();
    const push = (w: VocabItem | undefined) => {
      if (!w || seen.has(w.id)) return;
      seen.add(w.id);
      picked.push(w);
    };
    // 1) 错词本优先
    for (const id of progress.wrongIds) push(byId.get(id));
    // 2) 已学未掌握
    for (const w of VOCAB) {
      const p = progress.words[w.id];
      if (isLearned(p) && !isMastered(p)) push(w);
    }
    // 3) 已学要复习（有 learnedAt 的）
    const learned = VOCAB.filter((w) => isLearned(progress.words[w.id])).sort((a, b) => {
      const ta = progress.words[a.id]?.learnedAt || 0;
      const tb = progress.words[b.id]?.learnedAt || 0;
      return ta - tb;
    });
    for (const w of learned) push(w);
    // 4) 不够则从未学里补
    if (picked.length < DAILY_SIZE) {
      for (const w of shuffle(VOCAB)) push(w);
    }
    return shuffle(picked).slice(0, Math.min(DAILY_SIZE, Math.max(1, picked.length || VOCAB.length)));
  }

  function startDaily() {
    stopSpeak();
    const list = pickDailyPool();
    if (!list.length) {
      alert('词表为空');
      return;
    }
    setDailyQueue(list);
    setDailyIndex(0);
    setDailyStep('dictation');
    setDailyInput('');
    setDailyFeedback('idle');
    setHeard('');
    setDailyShadowPassed(false);
    setView('daily');
  }

  function advanceDaily(ok: boolean) {
    const w = dailyQueue[dailyIndex];
    if (!w) return;
    const nextState = markTestGate(progress, w.id, 'spell', ok);
    const withLearn = isLearned(nextState.words[w.id]) ? nextState : markLearned(nextState, w.id);
    update(withLearn);
    setDailyFeedback(ok ? 'ok' : 'bad');
    if (!ok) {
      // 拼错必须重试，不能进跟读
      window.setTimeout(() => {
        setDailyFeedback('idle');
        setDailyInput('');
      }, 900);
      return;
    }
    window.setTimeout(() => {
      setDailyStep('shadow');
      setDailyFeedback('idle');
      setDailyShadowPassed(false);
      setHeard('');
      speakItem(w, 1);
    }, 450);
  }

  function nextDailyWord() {
    if (dailyIndex + 1 < dailyQueue.length) {
      setDailyIndex(dailyIndex + 1);
      setDailyStep('dictation');
      setDailyInput('');
      setDailyFeedback('idle');
        setHeard('');
      setDailyShadowPassed(false);
    } else {
      setView('home');
    }
  }

  // sync coverEn chunk builder → spell gate
  useEffect(() => {
    if (learnStep !== 'coverEn' || !current || !picked.length) return;
    const joined = picked.join(current.word.includes(' ') ? ' ' : '');
    if (spellMatchesItem(joined, current)) {
      setCoverSpellOk(true);
      setCoverSpellInput(current.word);
    }
  }, [picked, learnStep, current?.id]);

  // auto TTS on meet
  useEffect(() => {
    if (view !== 'learn' || learnStep !== 'meet' || !current) return;
    if (meetPlayed.current) return;
    meetPlayed.current = true;
    const t = window.setTimeout(() => {
      speakItem(current, 2);
      setMeetListened(true);
    }, 280);
    return () => window.clearTimeout(t);
  }, [view, learnStep, current?.id]);

  function goLearnStep(step: LearnStep) {
    setLearnStep(step);
    setRevealZh(false);
    setRevealEn(false);
    setBuildMode(false);
    setBank([]);
    setPicked([]);
    setHeard('');
    setCoverSpellInput('');
    setCoverSpellOk(false);
    if (step === 'meet' && current) {
      meetPlayed.current = false;
      setMeetListened(false);
    }
    if (step === 'shadow') {
      setShadowPassed(false);
      if (current) window.setTimeout(() => speakItem(current, 1), 200);
    }
  }

  function finishWordLearn() {
    if (!current) return;
    const next = markLearned(progress, current.id);
    update(next);
    if (bi + 1 < batch.length) {
      meetPlayed.current = false;
      setBi(bi + 1);
      setLearnStep('meet');
      setRevealZh(false);
      setRevealEn(false);
      setBuildMode(false);
      setBank([]);
      setPicked([]);
      setHeard('');
      setMeetListened(false);
      setShadowPassed(false);
      setCoverSpellInput('');
      setCoverSpellOk(false);
    } else {
      // 整批学完 → 解锁测试
      const finished = batch.map((w) => {
        // ensure all marked (current just marked)
        return w;
      });
      setPendingTestBatch(finished);
      setView('batchDone');
    }
  }

  function openBuildPractice() {
    if (!current) return;
    const chunks = buildChunks(current.word);
    setBank(shuffle(chunks.map((text, i) => ({ id: `${i}-${text}`, text, used: false }))));
    setPicked([]);
    setBuildMode(true);
    setRevealEn(true);
  }

  function tapChunk(id: string) {
    setBank((prev) => {
      const chip = prev.find((c) => c.id === id);
      if (!chip || chip.used) return prev;
      setPicked((p) => [...p, chip.text]);
      return prev.map((c) => (c.id === id ? { ...c, used: true } : c));
    });
  }

  function undoChunk() {
    setPicked((prev) => {
      if (!prev.length) return prev;
      const last = prev[prev.length - 1];
      setBank((b) => {
        for (let i = b.length - 1; i >= 0; i -= 1) {
          if (b[i].used && b[i].text === last) {
            return b.map((c, idx) => (idx === i ? { ...c, used: false } : c));
          }
        }
        return b;
      });
      return prev.slice(0, -1);
    });
  }

  function startListen(target: 'shadow' | 'test' | 'daily' = 'shadow') {
    const rec = createRecognizer();
    if (!rec) {
      setHeard('本机无语音识别');
      return;
    }
    listenTarget.current = target;
    recRef.current = rec;
    setListening(true);
    setHeard('');
    rec.onresult = (ev) => {
      const texts = heardFromEvent(ev);
      if (!texts.length) return;
      const text = texts[0];
      setHeard(text);
      const item =
        target === 'test' ? testQueue[ti] : target === 'daily' ? dailyQueue[dailyIndex] : batch[bi];
      if (!item) return;
      if (speechMatchesItem(text, item)) {
        if (target === 'shadow') setShadowPassed(true);
        if (target === 'test') setSpeakPassed(true);
        if (target === 'daily') setDailyShadowPassed(true);
      }
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  }

  function prepareTestGate(item: VocabItem, g: TestGate) {
    setFeedback('idle');
    setSpellInput('');
    setHeard('');
    setSpeakPassed(false);
    if (g === 'pos') setChoices(pickPosChoices(item.pos));
    if (g === 'meaning') {
      const mode = Math.random() < 0.5 ? 'en2zh' : 'zh2en';
      setMeaningMode(mode);
      if (mode === 'en2zh') {
        setChoices(pickMeaningChoices(item, VOCAB.filter((x) => x.unit === item.unit)));
      } else {
        const pool = VOCAB.filter((x) => x.unit === item.unit && x.id !== item.id);
        setChoices(shuffle([item.word, ...shuffle(pool).slice(0, 3).map((x) => x.word)]));
      }
    }
  }

  function advanceTest(ok: boolean) {
    if (!testWord) return;
    const nextState = markTestGate(progress, testWord.id, testGate, ok);
    update(nextState);
    setFeedback(ok ? 'ok' : 'bad');
    if (!ok) {
      // 错了留在本关重试
      window.setTimeout(() => {
        setFeedback('idle');
        if (testGate === 'spell') setSpellInput('');
        if (testGate === 'speak') {
          setHeard('');
          setSpeakPassed(false);
        }
      }, 900);
      return;
    }
    const idx = TEST_GATES.indexOf(testGate);
    window.setTimeout(() => {
      if (idx < TEST_GATES.length - 1) {
        const ng = TEST_GATES[idx + 1];
        setTestGate(ng);
        prepareTestGate(testWord, ng);
      } else if (ti + 1 < testQueue.length) {
        const n = ti + 1;
        setTi(n);
        setTestGate('pos');
        prepareTestGate(testQueue[n], 'pos');
      } else {
        setView('home');
      }
    }, 420);
  }

  function setDay(d: DayPlan) {
    update({ ...progress, day: d, unitFilter: 0 });
    setView('home');
  }

  const weekendDone =
    statsFor(
      progress,
      VOCAB.map((w) => w.id),
    ).mastered === VOCAB.length;

  const learnStepIndex = LEARN_STEPS.indexOf(learnStep);

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 sm:px-6 lg:px-8 pb-10 pt-4 safe-pb">
      <header className="mb-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">广州版 · 三上</p>
            <h1 className="text-xl font-extrabold text-slate-900 sm:text-2xl">周末刷词 U1–U4</h1>
            <p className="mt-1 text-sm text-slate-500">先学后测 · 音标跟读 · 周末后可每日练</p>
          </div>
          <BookOpen className="h-8 w-8 shrink-0 text-emerald-500 sm:h-9 sm:w-9" />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {([1, 2] as DayPlan[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDay(d)}
              className={`rounded-full px-4 py-2 text-sm font-bold ${
                day === d ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              Day {d}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setView('wrong')}
            className="rounded-full bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 ring-1 ring-amber-200"
          >
            错词本 {wrongItems.length}
          </button>
          <button
            type="button"
            onClick={() => setView('list')}
            className="rounded-full bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700"
          >
            词表
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm('确定清空全部学习与测试进度？')) {
                update(resetProgress());
                setView('home');
              }
            }}
            className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700"
          >
            <RotateCcw className="h-3.5 w-3.5" /> 重置
          </button>
        </div>
      </header>

      {weekendDone ? (
        <div className="mb-4 flex items-center gap-3 rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-200">
          <Trophy className="h-8 w-8 text-emerald-600" />
          <div>
            <p className="font-extrabold text-emerald-800">周末目标达成！</p>
            <p className="text-sm text-emerald-700">U1–U4 均已学习并测过全对。之后点「每日练」巩固默写与发音。</p>
          </div>
        </div>
      ) : null}

      {view === 'home' ? (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 md:items-stretch">
            <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100 sm:p-5">
              <h2 className="mb-1 text-base font-extrabold sm:text-lg">Day {day} 进度</h2>
              <p className="mb-3 text-sm text-slate-600">
                {day === 1 ? '今日范围：Unit 1 + Unit 2' : '今日范围：Unit 3 + Unit 4（优先复习错词）'}
              </p>
              <div className="mb-2 flex justify-between text-xs text-slate-500">
                <span>已学习 {dayStats.learned}/{dayStats.total}</span>
                <span>{dayStats.learnedPct}%</span>
              </div>
              <ProgressBar pct={dayStats.learnedPct} color="bg-sky-500" />
              <div className="mb-2 mt-3 flex justify-between text-xs text-slate-500">
                <span>已掌握（测过全对）{dayStats.mastered}/{dayStats.total}</span>
                <span>{dayStats.masteredPct}%</span>
              </div>
              <ProgressBar pct={dayStats.masteredPct} color="bg-emerald-500" />

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => update({ ...progress, unitFilter: 0 })}
                  className={`rounded-lg px-3 py-2 text-xs font-bold ${progress.unitFilter === 0 ? 'bg-sky-600 text-white' : 'bg-slate-100'}`}
                >
                  本日全部
                </button>
                {dayUnits(day).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => update({ ...progress, unitFilter: u })}
                    className={`rounded-lg px-3 py-2 text-xs font-bold ${progress.unitFilter === u ? 'bg-sky-600 text-white' : 'bg-slate-100'}`}
                  >
                    Unit {u}
                  </button>
                ))}
              </div>

              <section className="mt-4 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
                <h3 className="mb-2 text-sm font-bold text-slate-800">单元一览</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {([1, 2, 3, 4] as const).map((u) => {
                    const ids = VOCAB.filter((w) => w.unit === u).map((w) => w.id);
                    const st = statsFor(progress, ids);
                    return (
                      <div key={u} className="rounded-xl border border-slate-100 bg-white p-3">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="text-sm font-bold">
                            {UNIT_META[u].title}
                          </span>
                          <span className="shrink-0 text-xs text-slate-500">
                            学{st.learned}/掌{st.mastered}/{st.total}
                          </span>
                        </div>
                        <ProgressBar pct={st.learnedPct} />
                      </div>
                    );
                  })}
                </div>
              </section>
            </section>

            <section className="flex flex-col justify-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100 sm:p-5">
              <h2 className="text-base font-extrabold text-slate-800 sm:text-lg">开始今日任务</h2>
              <button
                type="button"
                onClick={() => startLearn(false)}
                className="w-full rounded-2xl bg-emerald-600 py-4 text-base font-extrabold text-white shadow-md shadow-emerald-200"
              >
                今日学习（先学再测）
                <span className="mt-0.5 block text-xs font-semibold text-emerald-100">
                  每批 {BATCH_SIZE} 词 · 认识→跟读→遮盖回忆→小结
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!learnedWords.length) {
                    alert('还没有学完的词。请先点「今日学习」，把一小批词完整学完后再来检测。');
                    return;
                  }
                  const pool =
                    learnedNotMastered.length > 0
                      ? learnedNotMastered
                      : learnedWords;
                  startTest(pool.slice(0, Math.max(BATCH_SIZE, Math.min(12, pool.length))));
                }}
                className="w-full rounded-2xl bg-emerald-600 py-4 text-sm font-extrabold text-white"
              >
                检测巩固
                <span className="mt-0.5 block text-xs font-semibold text-emerald-100">
                  仅已学过的词 · 词性/意思/拼写/朗读计分
                </span>
              </button>


              <button
                type="button"
                onClick={() => startDaily()}
                className="w-full rounded-2xl bg-indigo-600 py-4 text-sm font-extrabold text-white shadow-md shadow-indigo-200"
              >
                <span className="inline-flex items-center gap-2"><PenLine className="h-4 w-4" /> 每日练</span>
                <span className="mt-0.5 block text-xs font-semibold text-indigo-100">
                  每天约 {DAILY_SIZE} 词 · 听写默写 + 音标对照 + 跟读
                </span>
              </button>

              {wrongItems.length > 0 ? (
                <button
                  type="button"
                  onClick={() => startLearn(true)}
                  className="w-full rounded-2xl bg-amber-500 py-3.5 text-sm font-bold text-white"
                >
                  错词再学一遍（{wrongItems.length}）
                </button>
              ) : null}
            </section>
          </div>

          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100 sm:p-5">
            <h3 className="mb-3 font-bold">学习怎么走？</h3>
            <ol className="grid list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-5">
              {[
                '认识：看词、听读 2 遍、记词性与中文',
                '跟读：再听 → 必须读对才能下一步',
                '英→中遮盖：先想意思和词性，再揭晓',
                '中→英：必须拼对才能进小结',
                '本批学完 → 才解锁该批「测试」',
              ].map((label, i) => (
                <li
                  key={label}
                  className="rounded-xl bg-sky-50 p-3 text-sm text-slate-700 ring-1 ring-sky-100"
                >
                  <span className="mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-sky-600 text-xs font-extrabold text-white">
                    {i + 1}
                  </span>
                  <p className="mt-1 leading-snug">{label}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      ) : null}

      {view === 'batchDone' ? (
        <div className="mx-auto max-w-3xl rounded-2xl bg-white p-5 text-center shadow-sm ring-1 ring-emerald-100 sm:p-6">
          <Check className="mx-auto h-12 w-12 text-emerald-500" />
          <h2 className="mt-2 text-xl font-extrabold text-slate-900">本批学习完成！</h2>
          <p className="mt-2 text-sm text-slate-600">
            已学完 {pendingTestBatch.length} 个词。现在可以进入计分测试，检验词性、意思、拼写和朗读。
          </p>
          <button
            type="button"
            onClick={() => startTest(pendingTestBatch)}
            className="mt-5 w-full rounded-2xl bg-emerald-600 py-3.5 font-extrabold text-white"
          >
            开始本批测试
          </button>
          <button
            type="button"
            onClick={() => setView('home')}
            className="mt-2 w-full rounded-2xl bg-slate-100 py-3 font-bold text-slate-700"
          >
            稍后再测，回首页
          </button>
          <button
            type="button"
            onClick={() => startLearn(false)}
            className="mt-2 w-full rounded-2xl py-2 text-sm font-semibold text-sky-700"
          >
            继续学下一批
          </button>
        </div>
      ) : null}

      {view === 'learn' && current ? (
        <div className="mx-auto max-w-3xl rounded-2xl bg-white p-4 shadow-sm ring-1 ring-sky-100 sm:p-6">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                stopSpeak();
                setView('home');
              }}
              className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600"
            >
              <X className="h-4 w-4" /> 结束学习
            </button>
            <span className="text-sm font-bold text-slate-500">
              学习 {bi + 1}/{batch.length}
            </span>
          </div>

          <div className="mb-3 flex gap-1">
            {LEARN_STEPS.map((s, i) => (
              <div
                key={s}
                className={`flex-1 rounded-full py-1 text-center text-[10px] font-bold ${
                  i === learnStepIndex
                    ? 'bg-sky-600 text-white'
                    : i < learnStepIndex
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-slate-100 text-slate-500'
                }`}
              >
                {LEARN_LABEL[s]}
              </div>
            ))}
          </div>

          <div className="mb-3 text-center text-xs font-semibold text-sky-600">
            Unit {current.unit}
            {current.star ? ' · 理解词*' : ''}
            {current.page ? ` · p.${current.page}` : ''}
          </div>

          {/* MEET */}
          {learnStep === 'meet' ? (
            <div className="space-y-3">
              <div className="rounded-2xl bg-sky-50 px-3 py-5 text-center sm:px-6 sm:py-8">
                <p className="font-[Plus_Jakarta_Sans] text-4xl font-extrabold tracking-tight text-slate-900">
                  {current.word}
                </p>
                <IpaLine ipa={current.ipa} size="lg" />
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  <PosBadge pos={current.pos} />
                  {current.star ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                      <Star className="h-3 w-3" /> 理解即可
                    </span>
                  ) : null}
                  {current.core ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-800">
                      课标词
                    </span>
                  ) : null}
                </div>
                <p className="mt-3 text-xl font-bold text-slate-800">{current.zh}</p>
              </div>
              <SpeakButton item={current} times={2} label="听读两遍（跟音标）" strong onPlayed={() => setMeetListened(true)} />
              <div className="rounded-xl bg-amber-50 p-3 text-left text-sm text-amber-950 ring-1 ring-amber-100">
                <p className="mb-1 font-bold">记忆钩子</p>
                <ul className="list-disc space-y-1 pl-4">
                  {memoryHook(current).map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
              <button
                type="button"
                disabled={!meetListened}
                onClick={() => goLearnStep('shadow')}
                className="w-full rounded-2xl bg-sky-600 py-3.5 font-extrabold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
              >
                下一步：跟读
              </button>
              {!meetListened ? <GateHint text="请先点「听读」听完再继续" /> : null}
            </div>
          ) : null}

          {/* SHADOW */}
          {learnStep === 'shadow' ? (
            <div className="space-y-3">
              <div className="rounded-2xl bg-violet-50 px-3 py-4 text-center sm:px-6 sm:py-6">
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-violet-600">先看音标再跟读</p>
                <IpaLine ipa={current.ipa} size="lg" />
                <p className="mt-3 text-3xl font-extrabold text-slate-900">{current.word}</p>
                <p className="mt-1 text-slate-600">{current.zh}</p>
              </div>
              <SpeakButton item={current} times={1} label="再听示范" strong />
              {speechSupported() ? (
                <>
                  <button
                    type="button"
                    onClick={() => startListen('shadow')}
                    disabled={listening}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-500 py-3.5 font-extrabold text-white disabled:opacity-60"
                  >
                    <Mic className="h-5 w-5" /> {listening ? '正在听…' : shadowPassed ? '读对了，可再试' : '点击跟读'}
                  </button>
                  {heard ? (
                    <p className="text-center text-sm text-slate-600">
                      识别：{heard}
                      {shadowPassed ? (
                        <span className="ml-2 font-bold text-emerald-600">正确</span>
                      ) : (
                        <span className="ml-2 font-bold text-rose-600">再试一次</span>
                      )}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    disabled={!shadowPassed}
                    onClick={() => goLearnStep('coverZh')}
                    className="w-full rounded-2xl bg-sky-600 py-3.5 font-extrabold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                  >
                    下一步：英→中
                  </button>
                  {!shadowPassed ? <GateHint text="读对后才能继续" /> : null}
                </>
              ) : (
                <>
                  <p className="text-center text-sm text-amber-700">
                    本机无语音识别。请大声跟读后点确认。
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setShadowPassed(true);
                      goLearnStep('coverZh');
                    }}
                    className="w-full rounded-2xl bg-sky-600 py-3.5 font-extrabold text-white"
                  >
                    我已大声跟读，下一步
                  </button>
                </>
              )}
            </div>
          ) : null}

          {/* COVER ZH */}
          {learnStep === 'coverZh' ? (
            <div className="space-y-3">
              <p className="text-center text-sm font-semibold text-slate-500">
                遮盖回忆 · 英→中：先自己想中文和词性
              </p>
              <div className="rounded-2xl bg-slate-50 px-3 py-6 text-center sm:px-6 sm:py-10">
                <p className="text-3xl font-extrabold text-slate-900">{current.word}</p>
                <IpaLine ipa={current.ipa} size="md" />
              </div>
              {!revealZh ? (
                <button
                  type="button"
                  onClick={() => setRevealZh(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 py-3.5 font-extrabold text-white"
                >
                  <Eye className="h-5 w-5" /> 显示答案
                </button>
              ) : (
                <>
                  <div className="rounded-xl bg-emerald-50 p-4 text-center ring-1 ring-emerald-100">
                    <PosBadge pos={current.pos} />
                    <p className="mt-2 text-xl font-bold text-slate-800">{current.zh}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => goLearnStep('coverEn')}
                      className="rounded-2xl bg-sky-600 py-3.5 font-extrabold text-white"
                    >
                      记住了
                    </button>
                    <button
                      type="button"
                      onClick={() => goLearnStep('meet')}
                      className="rounded-2xl bg-amber-100 py-3.5 font-extrabold text-amber-900"
                    >
                      还陌生
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : null}

          {/* COVER EN */}
          {learnStep === 'coverEn' ? (
            <div className="space-y-3">
              <p className="text-center text-sm font-semibold text-slate-500">
                遮盖回忆 · 中→英：必须拼对才能下一步
              </p>
              <div className="rounded-2xl bg-slate-50 px-3 py-6 text-center sm:px-6 sm:py-8">
                <div className="mb-2 flex justify-center">
                  <PosBadge pos={current.pos} />
                </div>
                <p className="text-2xl font-extrabold text-slate-900">{current.zh}</p>
                <IpaLine ipa={current.ipa} size="md" />
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const ok = spellMatchesItem(coverSpellInput, current);
                  setCoverSpellOk(ok);
                  if (!ok) {
                    setRevealEn(true);
                  }
                }}
                className="space-y-2"
              >
                <input
                  value={coverSpellInput}
                  onChange={(e) => {
                    setCoverSpellInput(e.target.value);
                    setCoverSpellOk(spellMatchesItem(e.target.value, current));
                  }}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="在此拼写英文"
                  className="w-full rounded-2xl border-2 border-sky-200 px-4 py-3.5 text-lg font-semibold outline-none focus:border-sky-500"
                />
                <button type="submit" className="w-full rounded-2xl bg-violet-600 py-3 font-extrabold text-white">
                  检查拼写
                </button>
              </form>
              {coverSpellOk ? (
                <p className="text-center text-sm font-bold text-emerald-600">拼对了！</p>
              ) : coverSpellInput && revealEn ? (
                <p className="text-center text-sm font-bold text-rose-600">
                  再试试。答案：{current.word}
                </p>
              ) : null}
              <button
                type="button"
                onClick={openBuildPractice}
                className="w-full rounded-2xl bg-sky-50 py-3 font-bold text-sky-800 ring-1 ring-sky-200"
              >
                用词块拼（可选）
              </button>
              {buildMode ? (
                <div className="space-y-2 rounded-xl bg-slate-50 p-3">
                  <div className="min-h-[2.5rem] rounded-lg bg-white px-2 py-2 text-center text-lg font-bold ring-1 ring-slate-200">
                    {picked.join(current.word.includes(' ') ? ' ' : '') || '…'}
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    {bank.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        disabled={c.used}
                        onClick={() => tapChunk(c.id)}
                        className={`rounded-xl px-3 py-2 text-sm font-bold ${
                          c.used ? 'bg-slate-100 text-slate-300' : 'bg-sky-100 text-sky-900'
                        }`}
                      >
                        {c.text}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={undoChunk} className="flex-1 rounded-xl bg-white py-2 text-sm font-bold ring-1 ring-slate-200">
                      撤销
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPicked([]);
                        setBank((b) => b.map((c) => ({ ...c, used: false })));
                      }}
                      className="flex-1 rounded-xl bg-white py-2 text-sm font-bold ring-1 ring-slate-200"
                    >
                      清空
                    </button>
                  </div>
                  {picked.length > 0 ? (
                    <p
                      className={`text-center text-sm font-bold ${
                        spellMatchesItem(picked.join(current.word.includes(' ') ? ' ' : ''), current)
                          ? 'text-emerald-600'
                          : 'text-slate-500'
                      }`}
                    >
                      {spellMatchesItem(picked.join(current.word.includes(' ') ? ' ' : ''), current)
                        ? '拼对了！'
                        : '继续调整…'}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <button
                type="button"
                disabled={!coverSpellOk}
                onClick={() => goLearnStep('done')}
                className="w-full rounded-2xl bg-sky-600 py-3.5 font-extrabold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
              >
                下一步：小结
              </button>
              {!coverSpellOk ? <GateHint text="拼对后才能继续" /> : null}
            </div>
          ) : null}

          {/* DONE */}
          {learnStep === 'done' ? (
            <div className="space-y-3 text-center">
              <div className="rounded-2xl bg-emerald-50 px-3 py-5 ring-1 ring-emerald-100">
                <Check className="mx-auto h-10 w-10 text-emerald-500" />
                <p className="mt-2 text-2xl font-extrabold text-slate-900">{current.word}</p>
                <p className="mt-1 text-slate-600">
                  <PosBadge pos={current.pos} /> <span className="ml-1">{current.zh}</span>
                </p>
                <p className="mt-3 text-sm font-semibold text-emerald-800">本词学习完成</p>
              </div>
              <IpaLine ipa={current.ipa} size="md" />
              <SpeakButton item={current} times={1} label="最后听一遍" />
              <button
                type="button"
                onClick={finishWordLearn}
                className="w-full rounded-2xl bg-sky-600 py-3.5 font-extrabold text-white"
              >
                {bi + 1 < batch.length ? '下一词' : '完成本批学习'}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {view === 'test' && testWord ? (
        <div className="mx-auto max-w-3xl rounded-2xl bg-white p-4 shadow-sm ring-1 ring-emerald-100 sm:p-6">
          <div className="mb-3 flex items-center justify-between">
            <button type="button" onClick={() => setView('home')} className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600">
              <X className="h-4 w-4" /> 结束测试
            </button>
            <span className="text-sm font-bold text-slate-500">
              测试 {ti + 1}/{testQueue.length}
            </span>
          </div>
          <div className="mb-3 flex gap-1">
            {TEST_GATES.map((g) => (
              <div
                key={g}
                className={`flex-1 rounded-full py-1 text-center text-[11px] font-bold ${
                  g === testGate
                    ? 'bg-emerald-600 text-white'
                    : progress.words[testWord.id]?.[g]
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-slate-100 text-slate-500'
                }`}
              >
                {TEST_LABEL[g]}
              </div>
            ))}
          </div>
          <p className="mb-2 text-center text-xs font-semibold text-emerald-700">计分检测 · 已学过的词</p>

          <div className="mb-4 text-center">
            {testGate === 'spell' || (testGate === 'meaning' && meaningMode === 'zh2en') ? (
              <>
                <p className="text-2xl font-extrabold text-slate-800">{testWord.zh}</p>
                {testGate === 'spell' ? null : <IpaLine ipa={testWord.ipa} size="sm" />}
              </>
            ) : (
              <>
                <p className="text-3xl font-extrabold text-slate-900">{testWord.word}</p>
                {testGate !== 'pos' ? <IpaLine ipa={testWord.ipa} size="md" /> : null}
              </>
            )}
          </div>

          {testGate === 'pos' ? (
            <div className="grid grid-cols-2 gap-2">
              {choices.map((c) => (
                <button
                  key={c}
                  type="button"
                  disabled={feedback !== 'idle'}
                  onClick={() => advanceTest(c === testWord.pos)}
                  className="rounded-2xl py-4 text-lg font-extrabold ring-1 ring-slate-200"
                >
                  {c}
                </button>
              ))}
            </div>
          ) : null}

          {testGate === 'meaning' ? (
            <div className="space-y-2">
              <p className="text-center text-xs text-slate-500">
                {meaningMode === 'en2zh' ? '看英文选中文' : '看中文选英文'}
              </p>
              {choices.map((c) => (
                <button
                  key={c}
                  type="button"
                  disabled={feedback !== 'idle'}
                  onClick={() =>
                    advanceTest(
                      meaningMode === 'en2zh' ? c === testWord.zh : spellMatchesItem(c, testWord),
                    )
                  }
                  className="w-full rounded-2xl bg-slate-50 px-3 py-3 text-left text-base font-semibold ring-1 ring-slate-200"
                >
                  {c}
                </button>
              ))}
            </div>
          ) : null}

          {testGate === 'spell' ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (feedback !== 'idle') return;
                advanceTest(spellMatchesItem(spellInput, testWord));
              }}
              className="space-y-3"
            >
              <SpeakButton item={testWord} times={1} label="听写发音" strong />
              <IpaLine ipa={testWord.ipa} size="md" />
              <input
                value={spellInput}
                onChange={(e) => setSpellInput(e.target.value)}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="默写英文"
                className="w-full rounded-2xl border-2 border-emerald-200 px-4 py-3.5 text-lg font-semibold outline-none focus:border-emerald-500"
              />
              <button type="submit" className="w-full rounded-2xl bg-emerald-600 py-3.5 font-extrabold text-white">
                检查（拼对才能下一关）
              </button>
              {feedback === 'bad' ? (
                <p className="text-center text-sm font-bold text-rose-600">
                  拼错了，已入错词本。答案：{testWord.word} · 请再拼一次
                </p>
              ) : null}
            </form>
          ) : null}

          {testGate === 'speak' ? (
            <div className="space-y-3">
              <IpaLine ipa={testWord.ipa} size="lg" />
              <SpeakButton item={testWord} times={1} label="听示范" strong />
              {speechSupported() ? (
                <>
                  <button
                    type="button"
                    onClick={() => startListen('test')}
                    disabled={listening || feedback !== 'idle'}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-500 py-3.5 font-extrabold text-white disabled:opacity-60"
                  >
                    <Mic className="h-5 w-5" /> {listening ? '正在听…' : speakPassed ? '读对了' : '朗读'}
                  </button>
                  {heard ? (
                    <p className="text-center text-sm">
                      识别：{heard}
                      {speakPassed ? (
                        <span className="ml-2 font-bold text-emerald-600">正确</span>
                      ) : (
                        <span className="ml-2 font-bold text-rose-600">再试</span>
                      )}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    disabled={!speakPassed || feedback !== 'idle'}
                    onClick={() => advanceTest(true)}
                    className="w-full rounded-2xl bg-emerald-600 py-3 font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                  >
                    朗读通过，下一关
                  </button>
                  {!speakPassed ? <GateHint text="读对后才能继续" /> : null}
                </>
              ) : (
                <>
                  <p className="text-center text-sm text-amber-700">本机无语音识别，请大声朗读后确认。</p>
                  <button
                    type="button"
                    disabled={feedback !== 'idle'}
                    onClick={() => advanceTest(true)}
                    className="w-full rounded-2xl bg-emerald-50 py-3 font-bold text-emerald-800 ring-1 ring-emerald-200"
                  >
                    我已朗读（本机无识别）
                  </button>
                </>
              )}
            </div>
          ) : null}

          {feedback === 'ok' ? (
            <p className="mt-3 text-center text-sm font-bold text-emerald-600">正确！</p>
          ) : feedback === 'bad' && testGate !== 'spell' ? (
            <p className="mt-3 text-center text-sm font-bold text-rose-600">记错了，已入错词本</p>
          ) : null}
        </div>
      ) : null}

      {view === 'wrong' ? (
        <div className="mx-auto max-w-3xl rounded-2xl bg-white p-4 shadow-sm sm:p-5">
          <button type="button" onClick={() => setView('home')} className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-sky-700">
            <ChevronLeft className="h-4 w-4" /> 返回
          </button>
          <h2 className="mb-2 flex items-center gap-2 text-lg font-extrabold">
            <ClipboardList className="h-5 w-5" /> 错词本
          </h2>
          {wrongItems.length === 0 ? (
            <p className="text-sm text-slate-500">暂无错词</p>
          ) : (
            <>
              <ul className="mb-3 max-h-[50vh] space-y-2 overflow-auto">
                {wrongItems.map((w) => (
                  <li key={w.id} className="rounded-xl bg-amber-50 px-3 py-2 text-sm">
                    <span className="font-bold">{w.word}</span>
                    <span className="mx-1 text-sm font-semibold text-indigo-700">{w.ipa || '/…/'}</span>
                    <span className="mx-1 text-slate-400">{w.pos}</span>
                    <span className="text-slate-600">{w.zh}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => startLearn(true)}
                className="mb-2 w-full rounded-2xl bg-sky-600 py-3 font-bold text-white"
              >
                先再学一遍
              </button>
              <button
                type="button"
                onClick={() => {
                  const learnedWrong = wrongItems.filter((w) => isLearned(progress.words[w.id]));
                  if (!learnedWrong.length) {
                    alert('这些错词请先走一遍学习过程。');
                    return;
                  }
                  startTest(learnedWrong);
                }}
                className="w-full rounded-2xl bg-amber-500 py-3 font-bold text-white"
              >
                学过的错词再测
              </button>
            </>
          )}
        </div>
      ) : null}

      {view === 'list' ? (
        <div className="mx-auto max-w-4xl rounded-2xl bg-white p-4 shadow-sm sm:p-5">
          <button type="button" onClick={() => setView('home')} className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-sky-700">
            <ChevronLeft className="h-4 w-4" /> 返回
          </button>
          <h2 className="mb-3 text-lg font-extrabold">课本词表（{VOCAB.length}）</h2>
          <div className="max-h-[70vh] space-y-4 overflow-auto md:grid md:max-h-none md:grid-cols-2 md:gap-4 md:space-y-0">
            {([1, 2, 3, 4] as const).map((u) => (
              <div key={u} className="md:max-h-[60vh] md:overflow-auto">
                <h3 className="sticky top-0 bg-white py-1 text-sm font-bold text-sky-800">Unit {u}</h3>
                <ul className="space-y-1">
                  {VOCAB.filter((w) => w.unit === u).map((w) => {
                    const p = progress.words[w.id];
                    return (
                      <li key={w.id} className="flex flex-wrap items-baseline gap-x-2 rounded-lg px-2 py-1 text-sm odd:bg-slate-50">
                        {w.star ? <Star className="h-3 w-3 text-amber-500" /> : null}
                        <span className="font-semibold">{w.word}</span>
                        <span className="text-sm font-semibold text-indigo-700">{w.ipa || '/…/'}</span>
                        <span className="text-xs text-sky-700">{w.pos}</span>
                        <span className="text-slate-600">{w.zh}</span>
                        {isLearned(p) ? <span className="text-[10px] font-bold text-sky-600">已学</span> : null}
                        {isMastered(p) ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* DAILY */}
      {view === 'daily' && dailyQueue[dailyIndex] ? (
        <div className="mx-auto max-w-3xl rounded-2xl bg-white p-4 shadow-sm ring-1 ring-indigo-100 sm:p-6">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                stopSpeak();
                setView('home');
              }}
              className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600"
            >
              <X className="h-4 w-4" /> 结束每日练
            </button>
            <span className="text-sm font-bold text-slate-500">
              每日练 {dailyIndex + 1}/{dailyQueue.length}
            </span>
          </div>
          {(() => {
            const dw = dailyQueue[dailyIndex];
            return (
              <div className="space-y-3">
                {dailyStep === 'dictation' || dailyStep === 'check' ? (
                  <>
                    <p className="text-center text-xs font-bold uppercase tracking-wide text-indigo-600">
                      听写 / 看中文写英文
                    </p>
                    <div className="rounded-2xl bg-indigo-50 px-3 py-6 text-center">
                      <PosBadge pos={dw.pos} />
                      <p className="mt-2 text-2xl font-extrabold text-slate-900">{dw.zh}</p>
                      <IpaLine ipa={dw.ipa} size="sm" />
                    </div>
                    <SpeakButton item={dw} times={1} label="听发音再默写" strong />
                    <IpaLine ipa={dw.ipa} size="md" />
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (dailyFeedback !== 'idle') return;
                        advanceDaily(spellMatchesItem(dailyInput, dw));
                      }}
                      className="space-y-2"
                    >
                      <input
                        value={dailyInput}
                        onChange={(e) => setDailyInput(e.target.value)}
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        placeholder="默写英文"
                        className="w-full rounded-2xl border-2 border-indigo-200 px-4 py-3.5 text-lg font-semibold outline-none focus:border-indigo-500"
                      />
                      <button type="submit" className="w-full rounded-2xl bg-indigo-600 py-3.5 font-extrabold text-white">
                        检查拼写（拼对才能跟读）
                      </button>
                    </form>
                    {dailyFeedback === 'ok' ? (
                      <p className="text-center text-sm font-bold text-emerald-600">拼对了！</p>
                    ) : null}
                    {dailyFeedback === 'bad' ? (
                      <p className="text-center text-sm font-bold text-rose-600">
                        拼错了，已入错词本。答案：{dw.word} {dw.ipa} · 请再默写
                      </p>
                    ) : null}
                  </>
                ) : (
                  <>
                    <p className="text-center text-xs font-bold uppercase tracking-wide text-violet-600">
                      音标对照 · 跟读
                    </p>
                    <div className="rounded-2xl bg-violet-50 px-3 py-6 text-center">
                      <IpaLine ipa={dw.ipa} size="lg" />
                      <p className="mt-3 text-3xl font-extrabold text-slate-900">{dw.word}</p>
                      <p className="mt-1 text-slate-600">{dw.zh}</p>
                    </div>
                    <SpeakButton item={dw} times={2} label="听两遍再跟读" strong />
                    {speechSupported() ? (
                      <>
                        <button
                          type="button"
                          onClick={() => startListen('daily')}
                          disabled={listening}
                          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-500 py-3.5 font-extrabold text-white disabled:opacity-60"
                        >
                          <Mic className="h-5 w-5" /> {listening ? '正在听…' : dailyShadowPassed ? '读对了' : '点击跟读'}
                        </button>
                        {heard ? (
                          <p className="text-center text-sm text-slate-600">
                            识别：{heard}
                            {dailyShadowPassed ? (
                              <span className="ml-2 font-bold text-emerald-600">正确</span>
                            ) : (
                              <span className="ml-2 font-bold text-rose-600">再试</span>
                            )}
                          </p>
                        ) : null}
                        <button
                          type="button"
                          disabled={!dailyShadowPassed}
                          onClick={nextDailyWord}
                          className="w-full rounded-2xl bg-sky-600 py-3.5 font-extrabold text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                        >
                          {dailyIndex + 1 < dailyQueue.length ? '下一词' : '完成本日练习'}
                        </button>
                        {!dailyShadowPassed ? <GateHint text="读对后才能继续" /> : null}
                      </>
                    ) : (
                      <>
                        <p className="text-center text-sm text-amber-700">本机无语音识别，请大声跟读后确认。</p>
                        <button
                          type="button"
                          onClick={nextDailyWord}
                          className="w-full rounded-2xl bg-sky-600 py-3.5 font-extrabold text-white"
                        >
                          {dailyIndex + 1 < dailyQueue.length ? '已跟读，下一词' : '完成本日练习'}
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            );
          })()}
        </div>
      ) : null}

      <footer className="mt-6 text-center text-[11px] text-slate-400">
        进度 gz3a_weekend_v2 · 共 {VOCAB.length} 条 · 读对/拼对才能下一步
      </footer>
    </div>
  );
}

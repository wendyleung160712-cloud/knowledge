import React, { useEffect, useState } from 'react';
import { Keyboard, PenLine } from 'lucide-react';
import type { VocabItem } from '../types';
import { ocrWarmup } from '../utils/handwritingOcr';
import { speakItem, spellMatchesItem } from '../utils/speech';
import HandwritingPad from './HandwritingPad';

export type DictationBoxProps = {
  item: VocabItem;
  /** Called after user taps check (handwrite OCR or keyboard). Parent gates next step. */
  onCheck: (ok: boolean, text: string) => void;
  disabled?: boolean;
  accent?: 'sky' | 'emerald' | 'indigo' | 'violet';
  /** Show Chinese meaning by default (toggleable). Never show English/IPA here. */
  showZhDefault?: boolean;
  checkLabel?: string;
  /** Extra controlled value reset key (e.g. word id + attempt) */
  resetKey?: string | number;
  feedback?: 'idle' | 'ok' | 'bad';
  /** When bad, parent may pass answer to reveal */
  revealWord?: string;
};

const BTN: Record<NonNullable<DictationBoxProps['accent']>, string> = {
  sky: 'bg-sky-600',
  emerald: 'bg-emerald-600',
  indigo: 'bg-indigo-600',
  violet: 'bg-violet-600',
};

const RING: Record<NonNullable<DictationBoxProps['accent']>, string> = {
  sky: 'border-sky-200 focus:border-sky-500',
  emerald: 'border-emerald-200 focus:border-emerald-500',
  indigo: 'border-indigo-200 focus:border-indigo-500',
  violet: 'border-violet-200 focus:border-violet-500',
};

export default function DictationBox({
  item,
  onCheck,
  disabled = false,
  accent = 'sky',
  showZhDefault = true,
  checkLabel = '检查',
  resetKey,
  feedback = 'idle',
  revealWord,
}: DictationBoxProps) {
  const [mode, setMode] = useState<'hand' | 'key'>('hand');
  const [showZh, setShowZh] = useState(showZhDefault);
  const [typed, setTyped] = useState('');
  const [heardOnce, setHeardOnce] = useState(false);

  useEffect(() => {
    setTyped('');
    setHeardOnce(false);
    setMode('hand');
    setShowZh(showZhDefault);
    ocrWarmup();
  }, [item.id, resetKey, showZhDefault]);

  function play() {
    speakItem(item, 1);
    setHeardOnce(true);
  }

  function submitKeyboard(e: React.FormEvent) {
    e.preventDefault();
    if (disabled || feedback === 'ok') return;
    const ok = spellMatchesItem(typed, item);
    onCheck(ok, typed);
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-slate-50 px-3 py-5 text-center sm:px-5">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">听写</p>
        {showZh ? (
          <p className="mt-2 text-2xl font-extrabold text-slate-900">{item.zh}</p>
        ) : (
          <p className="mt-2 text-base font-semibold text-slate-400">中文提示已隐藏 · 先听再写</p>
        )}
        <button
          type="button"
          onClick={() => setShowZh((v) => !v)}
          className="mt-2 text-xs font-bold text-indigo-600 underline-offset-2 hover:underline"
        >
          {showZh ? '隐藏中文提示' : '显示中文提示'}
        </button>
      </div>

      <button
        type="button"
        onClick={play}
        disabled={disabled}
        className={`flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 font-extrabold text-white shadow-md ${BTN[accent]}`}
      >
        {heardOnce ? '再听一遍' : '听发音'}
      </button>
      <p className="text-center text-xs text-slate-500">听写时不显示英文和音标，避免照抄</p>

      <div className="flex gap-2 rounded-2xl bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => setMode('hand')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-bold ${
            mode === 'hand' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
          }`}
        >
          <PenLine className="h-4 w-4" /> 手写
        </button>
        <button
          type="button"
          onClick={() => setMode('key')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-bold ${
            mode === 'key' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
          }`}
        >
          <Keyboard className="h-4 w-4" /> 键盘
        </button>
      </div>

      {mode === 'hand' ? (
        <HandwritingPad
          answer={item.word}
          matchFn={(t) => spellMatchesItem(t, item)}
          onResult={(ok, recognized) => {
            if (disabled || feedback === 'ok') return;
            onCheck(ok, recognized);
          }}
          disabled={disabled || feedback === 'ok'}
          accent={accent}
        />
      ) : (
        <form onSubmit={submitKeyboard} className="space-y-2">
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={disabled || feedback === 'ok'}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="键盘输入英文"
            className={`w-full rounded-2xl border-2 px-4 py-3.5 text-lg font-semibold outline-none ${RING[accent]}`}
          />
          <button
            type="submit"
            disabled={disabled || feedback === 'ok'}
            className={`w-full rounded-2xl py-3.5 font-extrabold text-white disabled:opacity-60 ${BTN[accent]}`}
          >
            {checkLabel}
          </button>
        </form>
      )}

      {feedback === 'ok' ? (
        <p className="text-center text-sm font-bold text-emerald-600">拼对了！</p>
      ) : null}
      {feedback === 'bad' ? (
        <p className="text-center text-sm font-bold text-rose-600">
          拼错了{revealWord ? `。答案：${revealWord}` : ''} · 请清空重写
        </p>
      ) : null}
    </div>
  );
}

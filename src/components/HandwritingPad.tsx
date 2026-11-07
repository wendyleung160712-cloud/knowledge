import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Eraser, Loader2, Undo2 } from 'lucide-react';
import { recognizeHandwriting } from '../utils/handwritingOcr';
import { spellMatches } from '../utils/speech';

type Point = { x: number; y: number };

export type HandwritingPadProps = {
  /** Canonical answer (display word). Prefer matchFn for multi-accept forms. */
  answer: string;
  /** Custom matcher (e.g. spellMatchesItem). Falls back to spellMatches(answer). */
  matchFn?: (recognized: string) => boolean;
  onResult: (ok: boolean, recognized: string) => void;
  disabled?: boolean;
  /** Accent for check button */
  accent?: 'sky' | 'emerald' | 'indigo' | 'violet';
  className?: string;
};

const ACCENT: Record<NonNullable<HandwritingPadProps['accent']>, string> = {
  sky: 'bg-sky-600',
  emerald: 'bg-emerald-600',
  indigo: 'bg-indigo-600',
  violet: 'bg-violet-600',
};

export default function HandwritingPad({
  answer,
  matchFn,
  onResult,
  disabled = false,
  accent = 'sky',
  className = '',
}: HandwritingPadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const strokesRef = useRef<Point[][]>([]);
  const drawingRef = useRef(false);
  const [strokeCount, setStrokeCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');
  const [lastRecognized, setLastRecognized] = useState('');

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = Math.max(280, wrap.clientWidth);
    const cssH = Math.max(180, Math.round(cssW * 0.42));
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    // light guide line
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(12, h * 0.72);
    ctx.lineTo(w - 12, h * 0.72);
    ctx.stroke();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 5.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of strokesRef.current) {
      if (stroke.length < 2) {
        if (stroke.length === 1) {
          ctx.beginPath();
          ctx.arc(stroke[0].x, stroke[0].y, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = '#0f172a';
          ctx.fill();
        }
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      for (let i = 1; i < stroke.length; i += 1) ctx.lineTo(stroke[i].x, stroke[i].y);
      ctx.stroke();
    }
    ctx.restore();
  }, []);

  useEffect(() => {
    resizeCanvas();
    const onResize = () => resizeCanvas();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [resizeCanvas]);

  // Clear when answer changes (new word)
  useEffect(() => {
    strokesRef.current = [];
    setStrokeCount(0);
    setHint('');
    setLastRecognized('');
    redraw();
  }, [answer, redraw]);

  function posFromEvent(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled || busy) return;
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    strokesRef.current.push([posFromEvent(e)]);
    setStrokeCount(strokesRef.current.length);
    setHint('');
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || disabled || busy) return;
    e.preventDefault();
    const stroke = strokesRef.current[strokesRef.current.length - 1];
    if (!stroke) return;
    stroke.push(posFromEvent(e));
    redraw();
  }

  function endStroke(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    redraw();
  }

  function undo() {
    if (disabled || busy) return;
    strokesRef.current.pop();
    setStrokeCount(strokesRef.current.length);
    setHint('');
    setLastRecognized('');
    redraw();
  }

  function clearAll() {
    if (disabled || busy) return;
    strokesRef.current = [];
    setStrokeCount(0);
    setHint('');
    setLastRecognized('');
    redraw();
  }

  async function check() {
    if (disabled || busy) return;
    if (strokeCount === 0) {
      setHint('请先在写字板上写英文');
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    setBusy(true);
    setHint('正在认字…（首次可能稍慢）');
    try {
      const recognized = await recognizeHandwriting(canvas);
      setLastRecognized(recognized);
      if (!recognized) {
        setHint('没认出字，请写大一点、清楚一点，或改用键盘');
        onResult(false, '');
        return;
      }
      const ok = matchFn ? matchFn(recognized) : spellMatches(recognized, answer);
      setHint(ok ? '认对了！' : '认错了，可重写或改用键盘');
      onResult(ok, recognized);
    } catch {
      setHint('认字失败，请写清楚些，或改用键盘输入');
      onResult(false, '');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <div
        ref={wrapRef}
        className="overflow-hidden rounded-2xl bg-white ring-2 ring-slate-200"
      >
        <canvas
          ref={canvasRef}
          className="block w-full touch-none select-none"
          style={{ touchAction: 'none', cursor: disabled ? 'not-allowed' : 'crosshair' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onPointerLeave={endStroke}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={undo}
          disabled={disabled || busy || strokeCount === 0}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-white py-2.5 text-sm font-bold text-slate-700 ring-1 ring-slate-200 disabled:opacity-40"
        >
          <Undo2 className="h-4 w-4" /> 撤销一笔
        </button>
        <button
          type="button"
          onClick={clearAll}
          disabled={disabled || busy || strokeCount === 0}
          className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-white py-2.5 text-sm font-bold text-slate-700 ring-1 ring-slate-200 disabled:opacity-40"
        >
          <Eraser className="h-4 w-4" /> 清空
        </button>
      </div>
      <button
        type="button"
        onClick={() => void check()}
        disabled={disabled || busy}
        className={`flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 font-extrabold text-white disabled:opacity-60 ${ACCENT[accent]}`}
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
        {busy ? '认字中…' : '认字检查'}
      </button>
      {lastRecognized ? (
        <p className="text-center text-sm font-semibold text-slate-700">
          识别为：<span className="font-extrabold text-slate-900">{lastRecognized}</span>
        </p>
      ) : null}
      {hint ? (
        <p
          className={`text-center text-sm font-bold ${
            hint.includes('对') ? 'text-emerald-600' : hint.includes('认字中') || hint.includes('正在') ? 'text-slate-500' : 'text-rose-600'
          }`}
        >
          {hint}
        </p>
      ) : (
        <p className="text-center text-xs text-slate-400">手指或 Apple Pencil 书写 · 写大一点更准</p>
      )}
    </div>
  );
}

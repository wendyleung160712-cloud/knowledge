import type { VocabItem } from '../types';

const POS_HINT: Record<string, string> = {
  'n.': '名词 n.：人/物/事的名称，前面常能加 a/an/the',
  'v.': '动词 v.：表示动作或状态，可接宾语或独自成谓',
  'adj.': '形容词 adj.：修饰名词，回答「什么样的」',
  'adv.': '副词 adv.：修饰动词/形容词，常以 -ly 结尾',
  'prep.': '介词 prep.：后接名词/代词，表方位、方式等',
  'pron.': '代词 pron.：代替名词，如 I/you/it/this',
  'conj.': '连词 conj.：连接词或句子，如 and/but',
  'interj.': '感叹词 interj.：打招呼或感叹，如 hi/hello/OK',
  'art.': '冠词 art.：a/an/the，放在名词前',
  'num.': '数词 num.：表示数量或顺序',
  'phr.': '短语 phr.：固定搭配，整块记忆，注意介词/冠词',
};

/** 简单记忆钩子：词性说明 + 拼写/搭配提示 */
export function memoryHook(item: VocabItem): string[] {
  const tips: string[] = [POS_HINT[item.pos] || `词性：${item.pos}`];
  if (item.ipa) tips.push(`音标跟读：${item.ipa}（先看音标再开口）`);
  if (item.star) tips.push('课本标 *：考试以理解为先，拼写要求相对宽松，但仍建议会读会认。');
  if (item.core) tips.push('黑体课标词：要求会读、会写、会对意思。');
  if (item.pos === 'phr.') {
    tips.push(`短语整记：「${item.word}」→ ${item.zh}`);
    if (/\bsomebody\b|\bsb\b/i.test(item.word)) tips.push('somebody 可记作 sb，做题时按课本完整形式写。');
    if (/\.\.\./.test(item.word)) tips.push('省略号处要填入具体词，默写时保留 … 或写出完整结构。');
  } else {
    const w = item.word.replace(/\s*\(.*\)\s*/g, '').trim();
    if (w.length >= 6 && !w.includes(' ')) tips.push(`拼写分段记：${chunkHint(w)}`);
    if (/tion$/.test(w)) tips.push('结尾 -tion 常读 /ʃn/，是名词常见后缀。');
    if (/ly$/.test(w) && item.pos === 'adv.') tips.push('很多副词由形容词 + ly 构成。');
    if (/ous$|ful$|less$/.test(w)) tips.push('后缀可帮助判断词性（如 -ful/-less 常为形容词）。');
  }
  tips.push(`中文锚点：看到「${item.zh.split('；')[0].split('（')[0]}」立刻想到 ${item.word}`);
  return tips.slice(0, 4);
}

function chunkHint(word: string): string {
  const parts: string[] = [];
  let i = 0;
  while (i < word.length) {
    const n = i + 3 <= word.length && word.length - i > 4 ? 3 : Math.min(4, word.length - i);
    parts.push(word.slice(i, i + n));
    i += n;
  }
  return parts.join(' · ');
}

/** 拼词块：短语按空格；单词按 2–3 字母或整词 */
export function buildChunks(word: string): string[] {
  const trimmed = word.trim();
  if (trimmed.includes(' ')) {
    return trimmed.split(/\s+/).filter(Boolean);
  }
  if (trimmed.length <= 4) return [trimmed];
  const chunks: string[] = [];
  let i = 0;
  while (i < trimmed.length) {
    const remain = trimmed.length - i;
    const size = remain <= 4 ? remain : remain === 5 ? 2 : 3;
    chunks.push(trimmed.slice(i, i + size));
    i += size;
  }
  return chunks;
}

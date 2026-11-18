const STAMP = /^%% sing-along: (\d+:\d{2}(?:\.\d{1,3})?)(?: --> (\d+:\d{2}(?:\.\d{1,3})?))? %%\s*$/;
function parseTime(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  const text = String(value).trim();
  if (/^\d+(?:\.\d{1,3})?$/.test(text)) return Number(text);
  const m = text.match(/^(\d+):([0-5]\d)(?:\.(\d{1,3}))?$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) + Number('0.' + (m[3] || '0')) : null;
}
function formatTime(value) {
  if (value === null || !Number.isFinite(value)) return '—';
  const ms = Math.round(value * 1000);
  return `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
function videoId(input) {
  const text = String(input || '').trim();
  if (/^[\w-]{11}$/.test(text)) return text;
  try {
    const u = new URL(text);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    let id;
    if (u.hostname === 'youtu.be') id = u.pathname.split('/')[1];
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com', 'youtube-nocookie.com'].includes(u.hostname)) {
      id = u.pathname === '/watch' ? u.searchParams.get('v') : /^\/(embed|shorts|live)\//.test(u.pathname) ? u.pathname.split('/')[2] : null;
    }
    return /^[\w-]{11}$/.test(id || '') ? id : null;
  } catch { return null; }
}
function plain(line) { return line.trim().replace(/^\*{1,2}|\*{1,2}$/g, ''); }
function parseLyrics(content) {
  const lines = content.split('\n');
  const found = lines.findIndex(l => /^## 歌詞對照\s*$/.test(l));
  const cues = []; const occurrences = new Map(); let section = '歌詞';
  if (found < 0) return cues;
  for (let i = found + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break;
    const heading = lines[i].match(/^###\s+(.+?)\s*$/);
    if (heading) { section = heading[1]; continue; }
    if (!/^\*[^*].*\*\s*$/.test(lines[i]) || !/^\*\*.+\*\*\s*$/.test(lines[i + 1] || '') || !lines[i + 2]?.trim()) continue;
    const romaji = plain(lines[i]), japanese = plain(lines[i + 1]), translation = lines[i + 2].trim();
    const fingerprint = JSON.stringify([section, romaji, japanese, translation]);
    const occurrence = (occurrences.get(fingerprint) || 0) + 1; occurrences.set(fingerprint, occurrence);
    const marker = (lines[i - 1] || '').match(STAMP);
    cues.push({key: fingerprint + ':' + occurrence, section, romaji, japanese, translation, line: i,
      markerLine: marker ? i - 1 : null, start: marker ? parseTime(marker[1]) : null, end: marker?.[2] ? parseTime(marker[2]) : null});
    i += 2;
  }
  return cues;
}
function validateTiming(cues, index, start, end) {
  if (!Number.isFinite(start) || start < 0) throw new Error('起點請填秒數或 mm:ss，例如 01:23.500。');
  if (end !== null && (!Number.isFinite(end) || end <= start)) throw new Error('終點必須晚於起點。');
  const previous = cues.slice(0, index).reverse().find(c => c.start !== null);
  const next = cues.slice(index + 1).find(c => c.start !== null);
  if (previous && start <= previous.start) throw new Error('本句起點必須晚於前面的已標記句子。');
  if (previous?.end !== null && previous?.end !== undefined && start < previous.end) throw new Error('本句起點不能早於前句終點。');
  if (next && (start >= next.start || (end !== null && end > next.start))) throw new Error('本句時間不能超過後面的已標記句子。');
}
function updateTiming(content, key, start, end = null) {
  const cues = parseLyrics(content); const index = cues.findIndex(c => c.key === key);
  if (index < 0) throw new Error('這句歌詞已修改，請重新載入後再標記。');
  validateTiming(cues, index, start, end);
  const cue = cues[index]; const lines = content.split('\n');
  const marker = `%% sing-along: ${formatTime(start)}${end === null ? '' : ' --> ' + formatTime(end)} %%`;
  if (cue.markerLine !== null) lines[cue.markerLine] = marker;
  else lines.splice(cue.line, 0, marker);
  return lines.join('\n');
}
function clearTiming(content, key) {
  const cue = parseLyrics(content).find(c => c.key === key);
  if (!cue) throw new Error('這句歌詞已修改，請重新載入。');
  if (cue.markerLine === null) return content;
  const lines = content.split('\n'); lines.splice(cue.markerLine, 1); return lines.join('\n');
}
function rangeFor(cues, index, duration = 0) {
  const cue = cues[index]; if (!cue || cue.start === null) return null;
  const end = cue.end ?? cues[index + 1]?.start ?? (index === cues.length - 1 && duration > cue.start ? duration : null);
  return end !== null && end > cue.start ? {start: cue.start, end} : null;
}
function activeAt(cues, time, duration = 0) {
  for (let i = cues.length - 1; i >= 0; i--) {
    const range = rangeFor(cues, i, duration);
    if (range && time >= range.start && time < range.end) return i;
  }
  return -1;
}
module.exports = {parseTime, formatTime, videoId, parseLyrics, updateTiming, clearTiming, rangeFor, activeAt};

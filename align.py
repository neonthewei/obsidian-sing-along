# /// script
# requires-python = ">=3.11,<3.12"
# dependencies = ["stable-ts[mlx]==2.19.1", "yt-dlp>=2026.1.1"]
# ///
"""Local audio-to-supplied-lyrics forced alignment. JSON lines over stdio; no server."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def emit(**data):
    print(json.dumps(data, ensure_ascii=False), flush=True)


def main():
    request = json.load(sys.stdin)
    video_id = request['videoId']
    lines = request['lines']
    if not re.fullmatch(r'[\w-]{11}', video_id) or not lines or len(lines) > 500:
        raise ValueError('影片或歌詞格式無效。')
    if not all(isinstance(line, str) and 0 < len(line) < 1000 for line in lines):
        raise ValueError('每句歌詞長度須介於 1 與 999 字。')
    digest = hashlib.sha256(json.dumps(lines, ensure_ascii=False).encode()).hexdigest()[:24]
    folder = Path.home() / '.cache' / 'obsidian-sing-along' / video_id
    folder.mkdir(parents=True, exist_ok=True)
    cache = folder / f'audio-asr-refined-q4-v5-{digest}.json'
    if cache.exists():
        result = json.loads(cache.read_text())
        emit(progress=f'已載入這支影片的 {len(result)} 句對齊結果。')
        emit(result=result)
        return
    emit(progress='準備影片音訊。')
    audio = next((p for p in folder.glob('audio.*') if p.suffix in ['.webm', '.m4a', '.opus', '.mp3', '.wav']), None)
    if audio is None:
        # Public video only, no browser/cookies/account access. Used solely for local analysis.
        command = [sys.executable, '-m', 'yt_dlp', '--no-playlist', '--no-progress', '--no-warnings',
                   '--match-filter', 'duration < 1200', '--max-filesize', '80M', '-f', 'bestaudio',
                   '-o', str(folder / 'audio.%(ext)s'), 'https://www.youtube.com/watch?v=' + video_id]
        completed = subprocess.run(command, stdout=sys.stderr, stderr=sys.stderr, timeout=240)
        if completed.returncode:
            raise RuntimeError('無法取得這支公開影片的音訊；請確認影片未設私人或限制存取。')
        audio = next((p for p in folder.glob('audio.*') if p.suffix in ['.webm', '.m4a', '.opus', '.mp3', '.wav']), None)
    if not audio:
        raise RuntimeError('沒有可分析的音訊，影片可能超過 20 分鐘。')
    emit(progress='載入日文對齊模型；首次使用需下載約 450 MB，之後會使用快取。')
    import mlx.core as mx
    import stable_whisper
    model_path = Path.home() / '.cache' / 'obsidian-sing-along' / 'models' / 'whisper-large-v3-turbo-q4'
    model = stable_whisper.load_mlx_whisper(str(model_path) if (model_path / 'weights.npz').exists() else 'mlx-community/whisper-large-v3-turbo-q4', dtype=mx.float16)
    emit(progress=f'正在辨識這支影片的日文演唱。')
    import mlx_whisper
    from alignment_utils import estimate_lines
    asr_cache = folder / 'asr-turbo-q4.json'
    if asr_cache.exists():
        transcript = json.loads(asr_cache.read_text())
    else:
        transcript = mlx_whisper.transcribe(str(audio), path_or_hf_repo=str(model_path) if (model_path / 'weights.npz').exists() else 'mlx-community/whisper-large-v3-turbo-q4',
                                           language='ja', word_timestamps=True, condition_on_previous_text=False,
                                           temperature=0, verbose=None)
        asr_cache.write_text(json.dumps(transcript, ensure_ascii=False))
    estimates = estimate_lines(lines, transcript['segments'])
    waveform = stable_whisper.audio.prep_audio(str(audio), sr=16000).numpy()
    # A lyric onset can cross Whisper's 30-second decoding boundary. Recheck
    # missing multi-character prefixes in a short overlapping audio window.
    for index, (line, estimate) in enumerate(zip(lines, estimates)):
        if estimate['prefix'] < 4:
            continue
        left = max(0, estimate['start'] - min(8.0, estimate['prefix'] * 0.7) - 0.8)
        right = min(len(waveform) / 16000, estimate['end'] + 0.8)
        if right - left > 29:
            continue
        boundary_cache = folder / f'boundary-asr-{digest}-{index}.json'
        if boundary_cache.exists():
            segments = json.loads(boundary_cache.read_text())
        else:
            cropped = mlx_whisper.transcribe(waveform[round(left*16000):round(right*16000)],
                path_or_hf_repo=str(model_path) if (model_path / 'weights.npz').exists() else 'mlx-community/whisper-large-v3-turbo-q4', language='ja', word_timestamps=True,
                condition_on_previous_text=False, temperature=0, verbose=None)
            segments = cropped['segments']
            for segment in segments:
                for word in segment.get('words', []):
                    word['start'] += left
                    word['end'] += left
            boundary_cache.write_text(json.dumps(segments, ensure_ascii=False))
        try:
            revised = estimate_lines([line], segments)[0]
        except ValueError:
            continue
        if revised['confidence'] >= 0.85 and revised['prefix'] < estimate['prefix']:
            estimates[index] = revised
    emit(progress='已找到各句位置，正在依實際音訊細化起訖。')
    regions = []
    for index, (line, estimate) in enumerate(zip(lines, estimates)):
        # Confine attention to the right phrase, avoiding repeated choruses and long instrumental gaps.
        lead = min(5.0, estimate['prefix'] * 0.6)
        tail = min(3.0, estimate['suffix'] * 0.4)
        left = (estimates[index-1]['end']+estimate['start'])/2 if index else 0
        right = (estimate['end']+estimates[index+1]['start'])/2 if index+1 < len(estimates) else estimate['end']+4
        regions.append({'text': line, 'start': max(0, left, estimate['start']-0.45-lead),
                        'end': min(right, estimate['end']+0.45+tail)})
    aligned = model.align_words(waveform, regions, language='ja',
                                suppress_silence=False, regroup=False, verbose=None)
    if aligned is None or len(aligned.segments) != len(lines):
        raise RuntimeError('模型未能完整對齊所有句子，未覆寫筆記。')
    aligned.save_as_json(str(folder / f'raw-word-alignment-{digest}.json'))
    result = []
    for index, segment in enumerate(aligned.segments):
        estimate = estimates[index]
        start = round(max(segment.start, estimate['start']) if estimate['prefix'] == 0 else segment.start, 3)
        end = round(max(segment.end, estimate['end']) if estimate['suffix'] == 0 else segment.end, 3)
        if end - start < 0.12 or (result and start <= result[-1]['start']):
            raise RuntimeError(f'第 {index+1} 句的對齊結果不可靠，未覆寫筆記。')
        result.append({'start': start, 'end': end})
    # Clamp tiny boundary overlaps only; significant overlap is a model failure.
    for i in range(len(result)-1):
        if result[i]['end'] > result[i+1]['start']:
            if result[i]['end'] - result[i+1]['start'] > 0.3:
                raise RuntimeError(f'第 {i+1} 句的邊界重疊，未覆寫筆記。')
            result[i]['end'] = result[i+1]['start']
    aligned.save_as_json(str(folder / f'word-alignment-{digest}.json'))
    temporary = cache.with_suffix('.tmp')
    temporary.write_text(json.dumps(result))
    os.replace(temporary, cache)
    emit(result=result)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        emit(error=str(error))
        print(type(error).__name__ + ': ' + str(error), file=sys.stderr)
        sys.exit(1)

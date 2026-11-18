"""Monotonic text/word-time matching; no model or network dependency."""
import unicodedata


def normalize(text):
    return ''.join(c for c in unicodedata.normalize('NFKC', text) if c.isalnum())


def estimate_lines(lines, segments):
    source, clocks = [], []
    for segment in segments:
        for word in segment.get('words', []):
            chars = normalize(word['word'])
            for index, char in enumerate(chars):
                length = len(chars)
                source.append(char)
                clocks.append((word['start'] + (word['end']-word['start'])*index/length,
                               word['start'] + (word['end']-word['start'])*(index+1)/length))
    reference = ''.join(map(normalize, lines))
    n, m = len(reference), len(source)
    if not n or not m or n*m > 8_000_000:
        raise ValueError('歌詞或辨識結果長度不適合自動對齊。')
    # Semi-global alignment: ignore unrelated audio before/after the song, preserve every chorus occurrence.
    previous = [0]*(m+1)
    trace = [bytearray(m+1) for _ in range(n+1)]
    for i in range(1, n+1):
        current = [-i] + [0]*m
        trace[i][0] = 1
        for j in range(1, m+1):
            choices = (previous[j-1] + (2 if reference[i-1] == source[j-1] else -1),
                       previous[j]-1, current[j-1]-1)
            best = max(choices)
            current[j] = best
            trace[i][j] = choices.index(best)
        previous = current
    i, j = n, max(range(m+1), key=lambda j: previous[j])
    mapping = {}
    while i > 0:
        direction = trace[i][j]
        if j and direction == 0:
            mapping[i-1] = (j-1, reference[i-1] == source[j-1])
            i, j = i-1, j-1
        elif direction == 1:
            i -= 1
        else:
            j -= 1
    estimates, position = [], 0
    for line in lines:
        size = len(normalize(line))
        matched = [(k, mapping[position+k]) for k in range(size) if position+k in mapping]
        position += size
        # Substitutions locate edits, but cannot anchor a time in unrelated intro audio.
        anchors = [pair for pair in matched if pair[1][1]]
        if not anchors:
            raise ValueError('有句子無法在影片音訊中找到，未寫入筆記。')
        start = clocks[anchors[0][1][0]][0]
        end = clocks[anchors[-1][1][0]][1]
        confidence = sum(pair[1][1] for pair in matched)/max(size, 1)
        estimates.append({'start': start, 'end': end, 'confidence': confidence,
                          'prefix': anchors[0][0], 'suffix': size-1-anchors[-1][0]})
    if min(e['confidence'] for e in estimates) < 0.3 or sum(e['confidence'] for e in estimates)/len(estimates) < 0.6:
        raise ValueError('歌詞和音訊辨識內容差異過大，未寫入筆記。')
    return estimates

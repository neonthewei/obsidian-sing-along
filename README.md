# Sing Along

Practise Japanese songs in Obsidian. Sing Along pairs a note of three-line lyrics (romaji, Japanese, translation) with a YouTube video, aligns every line to the video's audio on your own machine, and lets you click a line to jump, follow along, and loop a line or a section.

[中文說明](#中文說明)

> **Desktop only, macOS Apple Silicon only (for now).** Audio alignment runs locally with MLX Whisper. No API key and no cloud transcription service.

## Install

Not in the community store yet. Install with [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Install and enable **BRAT** from Community plugins.
2. Command palette → `BRAT: Add a beta plugin for testing` → paste `neonthewei/obsidian-sing-along`.
3. Enable **Sing Along** in Settings → Community plugins.
4. In a terminal: `brew install uv ffmpeg`.

BRAT keeps the plugin updated when a new release is published.

### Let an AI assistant walk you through it

This repo includes an agent skill, [`skills/sing-along`](skills/sing-along/SKILL.md), that guides you step by step: checks your Mac, installs the plugin, creates an empty lyric note, runs the first alignment and fixes common errors. It never fetches or writes song lyrics; you paste those yourself.

```bash
npx skills add neonthewei/obsidian-sing-along
```

Or copy it by hand for Claude Code:

```bash
git clone https://github.com/neonthewei/obsidian-sing-along /tmp/sing-along
mkdir -p ~/.claude/skills && cp -r /tmp/sing-along/skills/sing-along ~/.claude/skills/
```

Then tell your assistant: "Help me set up Sing Along".

## Features

- Opening a lyric note (one with a `sing_along_youtube` property) opens the player view automatically. Ordinary notes are untouched.
- One tab per song. Reopening a song returns to its tab with playback position and loop state kept.
- Auto-alignment: the first time you use a video, its audio is analysed and a hidden timestamp is written above each line. No manual tapping.
- Click a line to jump, current line is highlighted and kept centred, section dock on the left, playback dock at the bottom (speed, previous, play/pause, next, loop line).
- The video scrolls with the page and shrinks into a mini player above the section dock when it leaves the screen.

### Keyboard

| Key | Action |
|---|---|
| Space | Play / pause |
| ↑ / ↓ | Previous / next line |
| R | Toggle line loop |
| ⌘R | Toggle section loop |
| ⌘↑ / ⌘↓ | Previous / next section |

Keys are ignored while you type in a text field or use the speed menu.

## Lyric note format

```markdown
---
title: Song title
sing_along_youtube: https://www.youtube.com/watch?v=VIDEO_ID
---

## 歌詞對照

### Verse 1

*Romaji line*  
**日本語の行**  
Translation line

## Other notes
```

Only the block under the `## 歌詞對照` heading is read, up to the next level-2 heading. `###` headings become sections. Repeated lines in different sections get independent timestamps. After alignment each line gets a hidden comment:

```markdown
%% sing-along: 00:12.340 --> 00:17.820 %%
```

You supply the lyrics yourself. The plugin does not fetch or ship any lyrics.

## Requirements and what the plugin does on your machine

Please read this before installing.

- **External programs.** Alignment runs a bundled Python script (`align.py`) through [uv](https://docs.astral.sh/uv/) as a child process. You need `uv` and `ffmpeg` installed (for example `brew install uv ffmpeg`).
- **Downloads on first use.** uv installs the Python packages pinned in `align.py` (`stable-ts[mlx]`, `yt-dlp`), and the speech model `mlx-community/whisper-large-v3-turbo-q4` (about 450 MB) is downloaded from Hugging Face once.
- **YouTube audio.** yt-dlp downloads the audio of the public video you choose so it can be analysed. It does not use browser cookies or your account. Private, restricted or non-embeddable videos fail with a clear error.
- **Local cache.** The Python worker is bundled inside `main.js` and written to `~/.cache/obsidian-sing-along/worker/` on first use. Audio, the model and alignment results are stored in `~/.cache/obsidian-sing-along/`, outside your vault. Delete that folder to reclaim the space.
- **What goes into your vault.** Only the video URL (frontmatter) and the timestamp comments in your lyric note.
- **Playback.** The player uses the official YouTube IFrame API inside an isolated webview. YouTube's own controls and ads remain.

## Known limitations

- Timestamps are model estimates. Long instrumentals, harmonies, repeated lines and unusual vocal styles can drift. If alignment fails or the line count does not match, the note is not modified.
- Looping uses YouTube seek plus ~200 ms polling: fine for practice, not sample-accurate.
- Timestamps belong to one video. A different MV, live or album version needs its own alignment.
- Japanese only for now (alignment language is fixed to `ja`). The UI is in Traditional Chinese.

## Development

```bash
npm install
npm test                 # JavaScript + Python unit tests
npm run build            # bundles into dist/
OBSIDIAN_PLUGIN_DIR=/path/to/vault/.obsidian/plugins/sing-along npm run install-plugin
```

Source lives in `src/`. `align.py` is a JSON-over-stdio worker: input `videoId` and `lines`, output progress events and per-line start/end times.

## References

- [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference)
- [YouTube required minimum functionality](https://developers.google.com/youtube/terms/required-minimum-functionality)
- [stable-ts alignment](https://github.com/jianfch/stable-ts#alignment)
- [Obsidian Plugin API](https://github.com/obsidianmd/obsidian-api)

## License

[MIT](LICENSE)

---

## 中文說明

**Sing Along** 讓你在 Obsidian 裡跟著 YouTube 練唱日文歌：筆記裡放「羅馬拼音／日文／中文」三行歌詞，插件在本機分析影片音訊，自動對上每一句的時間，之後可以點句跳播、跟隨標亮、單句或整段循環。

- 安裝：先在社群插件裝 **BRAT**，命令面板執行「BRAT: Add a beta plugin for testing」，貼上 `neonthewei/obsidian-sing-along`，再到設定啟用 Sing Along。
- 想讓 AI 一步步帶你裝：執行 `npx skills add neonthewei/obsidian-sing-along`，再跟 Claude Code 說「幫我設定 Sing Along」。這個 skill 不會幫你抓或寫歌詞，歌詞要自己貼。
- 只支援桌面版，目前只支援 macOS Apple Silicon。
- 需要先安裝 `uv` 與 `ffmpeg`；第一次使用會下載 Python 套件和約 450 MB 的語音模型，之後使用快取。
- 音訊、模型與分析結果放在 `~/.cache/obsidian-sing-along/`，不進 vault；vault 裡只會多影片網址和每句上方的隱藏時間註解。
- 歌詞要自己準備，插件不會抓取或附帶任何歌詞。
- 時間點是模型估計，特殊唱腔、合聲或長間奏可能有偏差；對齊失敗時不會改動筆記。

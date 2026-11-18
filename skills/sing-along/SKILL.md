---
name: sing-along
description: Guide a user through installing, setting up and using the Sing Along Obsidian plugin, which syncs a three-line Japanese lyric note (romaji, Japanese, translation) with a YouTube video, auto-aligns each line locally and lets them click, follow and loop lines to practise singing. Use this whenever someone mentions Sing Along, 逐句學唱, neonthewei/obsidian-sing-along, installing it with BRAT, preparing a lyric note for it, or fixing alignment, playback or embedding problems in it, even if they just say "help me practise this Japanese song in Obsidian".
---

# Sing Along: guided setup and use

You are walking a user through the Sing Along Obsidian plugin. Many users are not technical, so do the checks yourself where you can, give one step at a time, and confirm each step worked before moving on. Reply in the user's language.

## Boundary on lyrics (read first)

Song lyrics are copyrighted. The plugin ships no lyrics, and you should not supply them either: do not search for, fetch, type out, transcribe from audio, romanize, or translate a song's lyrics, whether in full or line by line through a whole song. That includes "just add romaji to these lyrics I pasted" for a whole song. The user brings the lyrics (romaji, Japanese and translation lines) from a source they have access to and pastes them into the note themselves.

What you can do freely: create the empty template, explain the format, check their formatting, explain how to read or pronounce a word or a couple of lines they are stuck on, explain grammar, and point them to licensed sources (streaming apps' built-in lyrics, Uta-Net, the artist's site). If they push back, say plainly that you can't produce the song's lyrics, and keep helping with everything else.

## Step 1: Check the machine

Run `bash <skill-dir>/scripts/check_env.sh` if you have a shell. It reports macOS / Apple Silicon, uv, ffmpeg, and free disk space. If you have no shell, ask the user to confirm the same things.

- Sing Along currently works only in **Obsidian desktop on macOS with Apple Silicon (M1 or later)**. On Intel Macs, Windows, Linux or mobile, stop here and tell them it is not supported yet; playback-only use is not offered.
- Missing uv or ffmpeg: `brew install uv ffmpeg`. If Homebrew is missing, point them to https://brew.sh first.
- They need roughly 2 GB free for the Python packages and the ~450 MB speech model.

## Step 2: Install the plugin with BRAT

The plugin is not in the community store yet, so it installs through BRAT. Give these steps one at a time:

1. Obsidian → Settings → Community plugins. If "Restricted mode" is on, turn it off.
2. Browse → search **BRAT** (by TfTHacker) → Install → Enable.
3. Command palette (⌘P) → `BRAT: Add a beta plugin for testing` → paste `neonthewei/obsidian-sing-along` → Add plugin.
4. Settings → Community plugins → enable **Sing Along**.

If you have a shell and know the vault path, you can verify: `<vault>/.obsidian/plugins/sing-along/` should contain `main.js`, `manifest.json`, `styles.css`.

## Step 3: Create the lyric note

Copy `<skill-dir>/assets/lyric-note-template.md` into their vault (ask which folder), named after the song. Then fill in only what the user gives you: title, and the YouTube URL in `sing_along_youtube`. Leave the lyric slots for them.

Explain the format the plugin reads, because a small slip makes lines silently disappear:

- Everything sits under the heading `## 歌詞對照` (keep this exact text), until the next `##` heading.
- `### ` headings are sections (Verse 1, Chorus...). They become the section dock.
- Each line is three lines in this order: `*romaji*` (single asterisks), `**Japanese**` (double asterisks), then the translation as plain text. Put a blank line between line-groups.
- Repeating a chorus? Paste it again under its own `###` heading; each repeat gets its own timing.
- The video must be the exact version they want to sing with (MV, live and album versions have different timing). Private, age-restricted or non-embeddable videos will not work; pick another upload.

When they have pasted their lyrics, offer to check the format: count line-groups, look for a missing asterisk, a missing translation line, or lyrics outside `## 歌詞對照`. Report problems by section and line number. Do not rewrite their lyric text.

## Step 4: First alignment

1. Open the note. The player opens automatically because the note has `sing_along_youtube`. If not: ⌘P → `用目前筆記開啟逐句學唱`.
2. Press **自動對齊歌詞**. The first run installs packages and downloads the model, so it can take several minutes; later runs are much faster.
3. When it finishes, hidden `%% sing-along: mm:ss.xxx --> mm:ss.xxx %%` comments appear above each line. Click any line to jump; the current line is highlighted.

Controls: Space play/pause, ↑/↓ previous/next line, R loop line, ⌘R loop section, ⌘↑/⌘↓ previous/next section. The speed menu is at the left of the bottom dock. To edit the lyric text: player menu → 編輯歌詞原文, or ⌘P → `編輯目前歌詞原文`.

## Troubleshooting

Match the message the user sees (the UI is in Traditional Chinese):

| Message / symptom | What to do |
|---|---|
| 這份筆記尚未加入歌詞正文 / 找不到歌詞對照或 YouTube 網址 | Heading must be exactly `## 歌詞對照`; check the three-line format and the `sing_along_youtube` property. |
| 請貼上有效的 YouTube 影片網址 | Use a normal `youtube.com/watch?v=` or `youtu.be/` link. |
| 這支影片不允許嵌入 / YouTube 無法播放這支影片 / 影片已移除或設為私人 | Choose a different upload of the song; then re-align. |
| 無法啟動本機對齊程式 | uv not found. Run `brew install uv`, restart Obsidian. |
| 自動對齊失敗 + ffmpeg in the error | `brew install ffmpeg`, restart Obsidian. |
| 自動對齊結果句數不符，未寫入筆記 | Usually lyrics that are not sung in this video version, or lines missing. Compare the note against what is actually sung; remove extra lines; try again. |
| 歌詞在對齊途中已修改 | They edited the note during alignment. Run it again without editing. |
| 這份歌詞已有其他影片的時間點 | Timings belong to one video. Duplicate the note, delete the `%% sing-along ... %%` lines in the copy, then connect the new video. |
| A few lines are slightly early/late | Expected with harmonies, long instrumentals or unusual vocals. They can edit the times in the hidden comments by hand. |
| 請直接點影片上的播放鍵 | Browser autoplay rule: click play on the video once. |
| Free up disk space | Delete `~/.cache/obsidian-sing-along/` (audio, model, results). It is rebuilt on next use. |

If none of these match, ask for the exact message and what they clicked, and suggest opening an issue at https://github.com/neonthewei/obsidian-sing-along/issues.

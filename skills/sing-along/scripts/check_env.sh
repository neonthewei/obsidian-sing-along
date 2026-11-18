#!/usr/bin/env bash
# Checks whether this machine can run Sing Along's local alignment.
ok=1
os=$(uname -s); arch=$(uname -m)
if [ "$os" = "Darwin" ] && [ "$arch" = "arm64" ]; then echo "OK   macOS Apple Silicon ($arch)"; else echo "FAIL Needs macOS on Apple Silicon (found $os $arch)"; ok=0; fi
find_bin() { for p in "$HOME/.local/bin/$1" /opt/homebrew/bin/$1 /usr/local/bin/$1; do [ -x "$p" ] && { echo "$p"; return; }; done; command -v "$1"; }
for tool in uv ffmpeg; do
  p=$(find_bin $tool)
  if [ -n "$p" ]; then echo "OK   $tool ($p)"; else echo "FAIL $tool not found: brew install $tool"; ok=0; fi
done
command -v brew >/dev/null || echo "INFO Homebrew not found: see https://brew.sh"
free_gb=$(df -g "$HOME" 2>/dev/null | awk 'NR==2{print $4}')
if [ -n "$free_gb" ]; then
  if [ "$free_gb" -ge 2 ]; then echo "OK   ${free_gb} GB free"; else echo "WARN Only ${free_gb} GB free; about 2 GB is needed"; fi
fi
[ -d "$HOME/.cache/obsidian-sing-along" ] && echo "INFO Cache exists: ~/.cache/obsidian-sing-along"
[ $ok = 1 ] && echo "Ready." || echo "Not ready yet."

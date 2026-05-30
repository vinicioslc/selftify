#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RESOURCES_DIR="$ROOT_DIR/resources/mpv"

MPV_RELEASE_TAG="v0.39.0"

log()  { echo "[download-mpv] $*"; }
err()  { echo "[download-mpv] ERROR: $*" >&2; exit 1; }

case "${1:-}" in
  linux)   PLATFORM="linux" ;;
  win32)   PLATFORM="win32" ;;
  darwin)  PLATFORM="darwin" ;;
  all)
    log "Building for all platforms..."
    "$0" linux
    "$0" win32
    "$0" darwin
    exit 0
    ;;
  *)
    # Auto-detect
    case "$(uname -s)" in
      Linux*)  PLATFORM="linux" ;;
      Darwin*) PLATFORM="darwin" ;;
      MINGW*|MSYS*) PLATFORM="win32" ;;
      *) err "Unknown platform. Usage: $0 {linux|win32|darwin|all}" ;;
    esac
    ;;
esac

OUT_DIR="$RESOURCES_DIR/$PLATFORM"
mkdir -p "$OUT_DIR"

download_url() {
  local url="$1"
  local out="$2"
  if command -v curl &>/dev/null; then
    curl -fsSL "$url" -o "$out"
  elif command -v wget &>/dev/null; then
    wget -q "$url" -O "$out"
  else
    err "Neither curl nor wget found"
  fi
}

build_linux_static() {
  local out_bin="$OUT_DIR/mpv"
  if [[ -f "$out_bin" ]]; then
    log "Linux mpv already exists at $out_bin, skipping build"
    return 0
  fi

  if ! command -v docker &>/dev/null; then
    err "Docker is required to build a static mpv binary for Linux. Install Docker and retry."
  fi

  log "Building static Linux mpv binary via Docker..."
  docker build -t mpv-builder -f "$ROOT_DIR/docker/Dockerfile.mpv" "$ROOT_DIR"
  docker create --name mpv-tmp mpv-builder
  docker cp mpv-tmp:/mpv "$out_bin"
  docker rm mpv-tmp >/dev/null

  if [[ ! -f "$out_bin" ]]; then
    err "mpv binary was not copied from Docker container"
  fi

  chmod +x "$out_bin"
  log "Linux static mpv built: $out_bin ($(du -h "$out_bin" | cut -f1))"
}

download_win32() {
  local out_exe="$OUT_DIR/mpv.exe"
  if [[ -f "$out_exe" ]]; then
    log "Windows mpv already exists at $out_exe, skipping download"
    return 0
  fi

  log "Downloading Windows mpv build..."

  # Fetch the latest release info from sourceforge
  local sf_url="https://sourceforge.net/projects/mpv-player-windows/files/release"
  local tmp_dir
  tmp_dir="$(mktemp -d)"

  # Get the latest 7z filename from the release directory listing
  local latest_7z
  latest_7z=$(curl -fsSL "$sf_url/" | grep -oP 'mpv-x86_64-\d+-git-\w+\.7z' | sort -V | tail -1)
  if [[ -z "$latest_7z" ]]; then
    # Fallback: try the 64bit directory
    latest_7z=$(curl -fsSL "$sf_url/64bit/" | grep -oP 'mpv-x86_64-\d+-git-\w+\.7z' | sort -V | tail -1)
  fi

  if [[ -z "$latest_7z" ]]; then
    log "Could not find latest mpv Windows release on SourceForge, trying alternative..."

    # Alternative: use github releases of mpv-winbuild
    local gh_api_url="https://api.github.com/repos/zhongfly/mpv-winbuild/releases/latest"
    local gh_download_url
    gh_download_url=$(curl -fsSL "$gh_api_url" | grep -oP '"browser_download_url":\s*"([^"]+mpv-x86_64[^"]+)"' | sed 's/"browser_download_url": "//;s/"//' | head -1)

    if [[ -z "$gh_download_url" ]]; then
      err "Could not find Windows mpv binary. Try downloading manually and placing in $OUT_DIR"
    fi

    log "Downloading from GitHub: $gh_download_url"
    download_url "$gh_download_url" "$tmp_dir/mpv.7z"

    if command -v 7z &>/dev/null; then
      7z x "$tmp_dir/mpv.7z" -o"$tmp_dir/extract" -y >/dev/null
    elif command -v 7za &>/dev/null; then
      7za x "$tmp_dir/mpv.7z" -o"$tmp_dir/extract" -y >/dev/null
    else
      err "Need 7z (p7zip) to extract Windows mpv archive. Install it and retry."
    fi

    cp "$tmp_dir/extract"/*/mpv.exe "$OUT_DIR/" 2>/dev/null || true
    cp "$tmp_dir/extract"/*/mpv.com "$OUT_DIR/" 2>/dev/null || true
    # Copy required DLLs
    for dll in "$tmp_dir/extract"/*/*.dll; do
      if [[ -f "$dll" ]]; then
        cp "$dll" "$OUT_DIR/"
      fi
    done
  else
    log "Downloading: $sf_url/$latest_7z"
    download_url "$sf_url/$latest_7z" "$tmp_dir/mpv.7z"
    if command -v 7z &>/dev/null; then
      7z x "$tmp_dir/mpv.7z" -o"$OUT_DIR" -y >/dev/null
    elif command -v 7za &>/dev/null; then
      7za x "$tmp_dir/mpv.7z" -o"$OUT_DIR" -y >/dev/null
    else
      err "Need 7z (p7zip) to extract Windows mpv archive"
    fi
  fi

  rm -rf "$tmp_dir"

  if [[ ! -f "$OUT_DIR/mpv.exe" ]]; then
    err "mpv.exe not found after download. Check the download URL or place the binary manually in $OUT_DIR"
  fi

  chmod +x "$OUT_DIR/mpv.exe" "$OUT_DIR/mpv.com" 2>/dev/null || true
  log "Windows mpv downloaded: $OUT_DIR ($(du -sh "$OUT_DIR" | cut -f1))"
}

download_darwin() {
  local out_bin="$OUT_DIR/mpv"
  if [[ -f "$out_bin" ]]; then
    log "macOS mpv already exists at $out_bin, skipping download"
    return 0
  fi

  log "Downloading macOS mpv build..."

  # Try laboratory.stolendata.net (popular macOS mpv builds)
  local base_url="https://laboratory.stolendata.net/~djinn/mpv-builds"
  local latest_dmg
  latest_dmg=$(curl -fsSL "$base_url/" | grep -oP 'href="mpv-[^"]+\.dmg"' | sed 's/href="//;s/"//' | sort -V | tail -1)

  if [[ -n "$latest_dmg" ]]; then
    log "Downloading: $base_url/$latest_dmg"
    local tmp_dir
    tmp_dir="$(mktemp -d)"
    download_url "$base_url/$latest_dmg" "$tmp_dir/mpv.dmg"

    # Mount and extract binary
    local mount_point
    mount_point=$(hdiutil attach "$tmp_dir/mpv.dmg" -mountpoint /Volumes/mpv-tmp -nobrowse 2>/dev/null | tail -1 | awk '{print $NF}')
    if [[ -n "$mount_point" ]]; then
      cp "$mount_point/mpv.app/Contents/MacOS/mpv" "$out_bin" || cp "$mount_point/mpv" "$out_bin" 2>/dev/null || true
      hdiutil detach "$mount_point" >/dev/null 2>&1 || true
    fi
    rm -rf "$tmp_dir"
  fi

  # Fallback: try GitHub releases
  if [[ ! -f "$out_bin" ]]; then
    log "DMG download failed, trying GitHub..."
    local gh_url="https://github.com/eko5624/mpv-macos/releases/latest/download/mpv-macos.tar.bz2"
    local tmp_dir
    tmp_dir="$(mktemp -d)"
    download_url "$gh_url" "$tmp_dir/mpv.tar.bz2" || true
    if [[ -f "$tmp_dir/mpv.tar.bz2" ]]; then
      tar -xjf "$tmp_dir/mpv.tar.bz2" -C "$tmp_dir" || true
      find "$tmp_dir" -name "mpv" -type f -exec cp {} "$out_bin" \; 2>/dev/null || true
    fi
    rm -rf "$tmp_dir"
  fi

  if [[ ! -f "$out_bin" ]]; then
    log "WARNING: Could not download macOS mpv binary."
    log "Install mpv via Homebrew (brew install mpv) and symlink:"
    log "  ln -s \$(which mpv) $out_bin"
    log "Or place the binary manually at: $out_bin"
    return 0
  fi

  chmod +x "$out_bin"
  log "macOS mpv downloaded: $out_bin ($(du -h "$out_bin" | cut -f1))"
}

case "$PLATFORM" in
  linux)  build_linux_static ;;
  win32)  download_win32 ;;
  darwin) download_darwin ;;
esac

log "Done. mpv for $PLATFORM is ready at $OUT_DIR"

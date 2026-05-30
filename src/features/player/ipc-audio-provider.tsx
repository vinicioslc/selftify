import { useEffect, useRef } from "react";
import { usePlayerStore } from "../../stores/player.store";
import { useAuthStore } from "../../stores/auth.store";
import { PlayerStatus, OriginType as OriginTypeEnum } from "../../types/domain-types";
import { getController } from "../../api/controller";
import * as electronAudio from "../../services/electron-audio";

function mapOriginType(t: OriginTypeEnum | undefined): string {
  switch (t) {
    case OriginTypeEnum.YOUTUBE_MUSIC: return "ytmusic";
    case OriginTypeEnum.NAVIDROME:     return "navidrome";
    case OriginTypeEnum.SUBISONIC:     return "subsonic";
    case OriginTypeEnum.JELLYFIN:      return "jellyfin";
    default:                           return "ytmusic";
  }
}

export function IpcAudioProvider({ children }: { children: React.ReactNode }) {
  const statusRef = useRef(PlayerStatus.STOPPED);
  const nextRef = useRef<(() => void) | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const {
    currentTrack,
    status,
    volume,
    seek,
    seekId,
    setDuration,
    setPositionMs,
    next,
  } = usePlayerStore();

  const currentOrigin = useAuthStore((s) => s.currentOrigin);

  statusRef.current = status;
  nextRef.current = next;

  // Progress polling
  useEffect(() => {
    pollRef.current = setInterval(async () => {
      try {
        const pos = await electronAudio.getPosition();
        setPositionMs(pos * 1000);

        const dur = await electronAudio.getDuration();
        if (dur > 1 && pos >= dur - 0.5) {
          nextRef.current?.();
        }
      } catch {}
    }, 500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [setPositionMs]);

  // Load track via Electron IPC mpv
  useEffect(() => {
    if (!currentTrack?.id) return;
    const track = currentTrack;
    const sourceType = mapOriginType(currentOrigin?.type);

    let cancelled = false;

    async function loadTrack() {
      try {
        const controller = await getController();
        const url = await controller.getStreamUrl(track.id);
        if (!url || cancelled) return;

        setPositionMs(0);
        setDuration(0);

        await electronAudio.loadTrack(url);

        if (cancelled) return;

        const dur = await electronAudio.getDuration();
        setDuration(dur * 1000);

        const { status: s } = usePlayerStore.getState();
        if (s !== PlayerStatus.PLAYING) {
          await electronAudio.pause();
        }
      } catch (err) {
        console.error("[ipc] load failed:", err);
      }
    }
    loadTrack();
    return () => { cancelled = true; };
  }, [currentTrack?.id, setDuration, setPositionMs, currentOrigin?.type]);

  // Play/pause
  useEffect(() => {
    if (status === PlayerStatus.PLAYING) {
      electronAudio.resume().catch((err) => console.error("[ipc] resume:", err));
    } else if (status === PlayerStatus.PAUSED) {
      electronAudio.pause().catch((err) => console.error("[ipc] pause:", err));
    }
  }, [status]);

  // Volume
  useEffect(() => {
    electronAudio.setVolume(volume).catch((err) => console.error("[ipc] setVolume:", err));
  }, [volume]);

  // Seek
  useEffect(() => {
    if (seek !== undefined) {
      electronAudio.seek(seek / 1000).catch((err) => console.error("[ipc] seek:", err));
    }
  }, [seekId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      electronAudio.stopPlayback().catch((err) => console.error("[ipc] stop:", err));
    };
  }, []);

  return <>{children}</>;
}

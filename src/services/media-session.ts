import { usePlayerStore } from "../stores/player.store";
import { PlayerStatus } from "../types/domain-types";

export function initMediaSession(): () => void {
  if (!("mediaSession" in navigator)) return () => {};

  const updateMetadata = () => {
    const { currentTrack } = usePlayerStore.getState();
    if (!currentTrack) {
      navigator.mediaSession.metadata = null;
      return;
    }

    const artwork: MediaImage[] = [];
    if (currentTrack.imageUrl) {
      artwork.push({ src: currentTrack.imageUrl, sizes: "512x512", type: "image/jpeg" });
    }

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.name,
        artist: currentTrack.artistName,
        album: currentTrack.albumName || undefined,
        artwork,
      });
    } catch {
    }
  };

  const updatePlaybackState = () => {
    const { status } = usePlayerStore.getState();
    try {
      navigator.mediaSession.playbackState =
        status === PlayerStatus.PLAYING ? "playing" : "paused";
    } catch {
    }
  };

  try {
    navigator.mediaSession.setActionHandler("play", () => {
      usePlayerStore.getState().play();
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      usePlayerStore.getState().pause();
    });
    navigator.mediaSession.setActionHandler("previoustrack", () => {
      usePlayerStore.getState().previous();
    });
    navigator.mediaSession.setActionHandler("nexttrack", () => {
      usePlayerStore.getState().next();
    });
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (details.seekTime != null) {
        usePlayerStore.getState().setSeek(details.seekTime);
      }
    });
  } catch {
  }

  const unsub = usePlayerStore.subscribe(() => {
    updateMetadata();
    updatePlaybackState();
    const api = (window as any).electronApi;
    if (api?.sendMediaPlaybackState) {
      const { status } = usePlayerStore.getState();
      api.sendMediaPlaybackState(status === PlayerStatus.PLAYING);
    }
  });

  updateMetadata();
  updatePlaybackState();

  return () => {
    unsub();
    try {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.setActionHandler("previoustrack", null);
      navigator.mediaSession.setActionHandler("nexttrack", null);
      navigator.mediaSession.setActionHandler("seekto", null);
    } catch {
    }
  };
}

export function initElectronMediaControls(): () => void {
  if (typeof window === "undefined") return () => {};
  const api = (window as any).electronApi;
  if (!api?.onMediaAction) return () => {};

  const unsub = api.onMediaAction((action: string) => {
    const store = usePlayerStore.getState();
    switch (action) {
      case "playpause":
        store.togglePlay();
        break;
      case "play":
        store.play();
        break;
      case "pause":
        store.pause();
        break;
      case "next":
        store.next();
        break;
      case "previous":
        store.previous();
        break;
    }
  });

  return unsub;
}
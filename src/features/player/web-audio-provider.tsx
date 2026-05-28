import { useEffect, useRef, useCallback } from "react";
import { usePlayerStore } from "../../stores/player.store";
import { PlayerStatus } from "../../types/domain-types";
import { getController } from "../../api/controller";

export function WebAudioProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const {
    currentTrack,
    status,
    volume,
    seek,
    play,
    pause,
    setDuration,
    setPositionMs,
    setSeek,
    next,
  } = usePlayerStore();

  // Initialize audio element
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.preload = "auto";
    }
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  // Set up Web Audio API for visualizations
  useEffect(() => {
    if (!audioRef.current) return;
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
      sourceRef.current = audioCtxRef.current.createMediaElementSource(audioRef.current);
      analyserRef.current = audioCtxRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      sourceRef.current.connect(analyserRef.current);
      analyserRef.current.connect(audioCtxRef.current.destination);
    }
  }, []);

  // Load track
  useEffect(() => {
    if (!currentTrack?.id || !audioRef.current) return;
    const audio = audioRef.current;
    const trackId = currentTrack.id;

    async function loadTrack() {
      try {
        const controller = await getController();
        const url = await controller.getStreamUrl(trackId);
        if (url) {
          audio.src = url;
          audio.load();
        }
      } catch (err) {
        console.error("Failed to load track:", err);
      }
    }
    loadTrack();
  }, [currentTrack?.id]);

  // Play/pause
  useEffect(() => {
    if (!audioRef.current) return;
    const audio = audioRef.current;

    if (status === PlayerStatus.PLAYING) {
      audio.play().catch(console.error);
    } else if (status === PlayerStatus.PAUSED) {
      audio.pause();
    }
  }, [status]);

  // Volume
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // Seek
  useEffect(() => {
    if (audioRef.current && seek !== undefined) {
      audioRef.current.currentTime = seek / 1000;
    }
  }, [seek]);

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setPositionMs(audio.currentTime * 1000);
    const onDurationChange = () => setDuration(audio.duration * 1000);
    const onEnded = () => next();
    const onPlay = () => play();
    const onPause = () => pause();

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, [setPositionMs, setDuration, next, play, pause]);

  // Expose analyser node for visualizers
  useEffect(() => {
    if (analyserRef.current) {
      (window as any).__audioAnalyser = analyserRef.current;
    }
  }, []);

  return <>{children}</>;
}

export function getAudioAnalyser(): AnalyserNode | null {
  return (window as any).__audioAnalyser || null;
}

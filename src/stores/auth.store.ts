import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Origin } from "../types/domain-types";

type AuthState = {
  currentOrigin: Origin | null;
  origins: Origin[];
  setCurrentOrigin: (origin: Origin | null) => void;
  addOrigin: (origin: Origin) => void;
  removeOrigin: (id: string) => void;
  updateOrigin: (id: string, updates: Partial<Origin>) => void;
  clearAuth: () => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      currentOrigin: null,
      origins: [],
      setCurrentOrigin: (origin) => set({ currentOrigin: origin }),
      addOrigin: (origin) =>
        set((state) => ({
          origins: [...state.origins.filter((s) => s.id !== origin.id), origin],
        })),
      removeOrigin: (id) =>
        set((state) => ({
          origins: state.origins.filter((s) => s.id !== id),
          currentOrigin: state.currentOrigin?.id === id ? null : state.currentOrigin,
        })),
      updateOrigin: (id, updates) =>
        set((state) => ({
          origins: state.origins.map((s) =>
            s.id === id ? { ...s, ...updates } : s
          ),
          currentOrigin:
            state.currentOrigin?.id === id
              ? { ...state.currentOrigin, ...updates }
              : state.currentOrigin,
        })),
      clearAuth: () => set({ currentOrigin: null, origins: [] }),
    }),
    {
      name: "ytmusic-auth",
      partialize: (state) => ({
        origins: state.origins,
        currentOrigin: state.currentOrigin,
      }),
    }
  )
);

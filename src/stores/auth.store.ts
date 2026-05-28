import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ServerListItem } from "../types/domain-types";

type AuthState = {
  currentServer: ServerListItem | null;
  serverList: ServerListItem[];
  setCurrentServer: (server: ServerListItem | null) => void;
  addServer: (server: ServerListItem) => void;
  removeServer: (id: string) => void;
  updateServer: (id: string, updates: Partial<ServerListItem>) => void;
  clearAuth: () => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      currentServer: null,
      serverList: [],
      setCurrentServer: (server) => set({ currentServer: server }),
      addServer: (server) =>
        set((state) => ({
          serverList: [...state.serverList.filter((s) => s.id !== server.id), server],
        })),
      removeServer: (id) =>
        set((state) => ({
          serverList: state.serverList.filter((s) => s.id !== id),
          currentServer: state.currentServer?.id === id ? null : state.currentServer,
        })),
      updateServer: (id, updates) =>
        set((state) => ({
          serverList: state.serverList.map((s) =>
            s.id === id ? { ...s, ...updates } : s
          ),
          currentServer:
            state.currentServer?.id === id
              ? { ...state.currentServer, ...updates }
              : state.currentServer,
        })),
      clearAuth: () => set({ currentServer: null, serverList: [] }),
    }),
    {
      name: "ytmusic-auth",
      partialize: (state) => ({
        serverList: state.serverList,
        currentServer: state.currentServer,
      }),
    }
  )
);

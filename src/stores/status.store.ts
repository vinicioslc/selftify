import { create } from "zustand";
import type { StatusLevel, StatusMessage } from "../types/status-types";

const MAX_MESSAGES = 200;

let nextId = 0;

function generateId(): string {
  return `status-${++nextId}-${Date.now()}`;
}

type StatusState = {
  messages: StatusMessage[];
  addMessage: (text: string, level?: StatusLevel, source?: string) => void;
  removeMessage: (id: string) => void;
  clearMessages: () => void;
};

export const useStatusStore = create<StatusState>()((set) => ({
  messages: [],
  addMessage: (text, level = "info", source) => {
    const msg: StatusMessage = {
      id: generateId(),
      text,
      level,
      timestamp: Date.now(),
      source,
    };
    set((state) => {
      const next = [...state.messages, msg];
      if (next.length > MAX_MESSAGES) {
        return { messages: next.slice(next.length - MAX_MESSAGES) };
      }
      return { messages: next };
    });
  },
  removeMessage: (id) =>
    set((state) => ({
      messages: state.messages.filter((m) => m.id !== id),
    })),
  clearMessages: () => set({ messages: [] }),
}));

import { create } from "zustand";

export type ToastVariant = "info" | "success" | "warn" | "danger";

export type Toast = {
  id: string;
  text: string;
  variant: ToastVariant;
  createdAt: number;
};

type ToastState = {
  toasts: Toast[];
  toast: (text: string, variant?: ToastVariant) => void;
  dismiss: (id: string) => void;
};

let nextToastId = 0;

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  toast: (text, variant = "info") => {
    const id = `toast-${++nextToastId}`;
    const toast: Toast = { id, text, variant, createdAt: Date.now() };
    set((state) => ({ toasts: [...state.toasts, toast] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 5000);
  },
  dismiss: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

import { create } from "zustand";
import type { TaskCalendarSnapshot } from "../types/taskCalendar";
import { getTaskCalendarSnapshot } from "../services/taskCalendarService";

interface TaskCalendarState {
  isOpen: boolean;
  snapshot: TaskCalendarSnapshot | null;
  error: string | null;
  loading: boolean;
  open: () => void;
  close: () => void;
  reload: () => Promise<void>;
}
let reloadPromise: Promise<void> | null = null;
let reloadRequested = false;

export const useTaskCalendarStore = create<TaskCalendarState>((set) => ({
  isOpen:
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("taskCalendar") === "1",
  snapshot: null,
  error: null,
  loading: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  reload: () => {
    reloadRequested = true;
    if (reloadPromise) return reloadPromise;
    set({ loading: true });
    reloadPromise = (async () => {
      try {
        while (reloadRequested) {
          reloadRequested = false;
          const snapshot = await getTaskCalendarSnapshot();
          set((state) => ({
            snapshot:
              !state.snapshot || snapshot.version >= state.snapshot.version
                ? snapshot
                : state.snapshot,
            error: null,
          }));
        }
      } catch (error) {
        set({ error: String(error) });
      } finally {
        reloadPromise = null;
        set({ loading: false });
      }
    })();
    return reloadPromise;
  },
}));

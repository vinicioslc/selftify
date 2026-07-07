import type { IpcMain, BrowserWindow } from "electron";
import { generateId } from "../src/lib/utils";
import type { Song, DownloadTask } from "../src/types/domain-types";
import { DownloadStatus } from "../src/types/domain-types";
import * as db from "./download-db";

type WindowProvider = () => BrowserWindow | null;

export function registerDownloadQueueHandlers(
  ipcMain: IpcMain,
  getWindow: WindowProvider,
): void {
  ipcMain.handle("download:enqueue", (_event, song: Song): DownloadTask | null => {
    const existing = db.getAllTasks();
    const alreadyInQueue = existing.some(
      (t) => t.song.id === song.id && t.status !== DownloadStatus.CANCELLED && t.status !== DownloadStatus.COMPLETED,
    );
    if (alreadyInQueue) return null;

    const task: DownloadTask = {
      id: generateId(),
      song,
      status: DownloadStatus.PENDING,
      progress: 0,
      stepLabel: "Waiting...",
      createdAt: Date.now(),
    };
    db.insertTask(task);
    broadcastTaskUpdate(getWindow, task);
    return task;
  });

  ipcMain.handle("download:enqueue-multiple", (_event, songs: Song[]): DownloadTask[] => {
    const tasks: DownloadTask[] = [];
    const existing = db.getAllTasks();
    for (const song of songs) {
      const alreadyInQueue = existing.some(
        (t) => t.song.id === song.id && t.status !== DownloadStatus.CANCELLED && t.status !== DownloadStatus.COMPLETED,
      );
      if (alreadyInQueue) continue;
      const task: DownloadTask = {
        id: generateId(),
        song,
        status: DownloadStatus.PENDING,
        progress: 0,
        stepLabel: "Waiting...",
        createdAt: Date.now(),
      };
      db.insertTask(task);
      broadcastTaskUpdate(getWindow, task);
      tasks.push(task);
    }
    return tasks;
  });

  ipcMain.handle("download:cancel", (_event, taskId: string): void => {
    const task = db.getTaskById(taskId);
    if (!task) return;
    db.upsertTask({
      id: taskId,
      status: DownloadStatus.CANCELLED,
      stepLabel: "Cancelled",
    });
    const updated = db.getTaskById(taskId);
    if (updated) broadcastTaskUpdate(getWindow, updated);
  });

  ipcMain.handle("download:retry", (_event, taskId: string): void => {
    const task = db.getTaskById(taskId);
    if (!task) return;
    db.upsertTask({
      id: taskId,
      status: DownloadStatus.PENDING,
      progress: 0,
      stepLabel: "Waiting...",
      error: undefined,
      videoId: undefined,
      audioPath: undefined,
      coverPath: undefined,
      completedAt: undefined,
    });
    const updated = db.getTaskById(taskId);
    if (updated) broadcastTaskUpdate(getWindow, updated);
  });

  ipcMain.handle("download:list", (): DownloadTask[] => {
    return db.getAllTasks();
  });

  ipcMain.handle("download:clear-completed", (): void => {
    db.deleteCompletedTasks();
    const remaining = db.getAllTasks();
    for (const task of remaining) {
      broadcastTaskUpdate(getWindow, task);
    }
  });

  ipcMain.handle("download:update-task", (_event, taskId: string, partial: Partial<DownloadTask>): void => {
    db.upsertTask({ id: taskId, ...partial });
    const updated = db.getTaskById(taskId);
    if (updated) broadcastTaskUpdate(getWindow, updated);
  });
}

function broadcastTaskUpdate(getWindow: WindowProvider, task: DownloadTask): void {
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send("download:task-update", task);
  }
}

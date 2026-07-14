import { type Request, type Response } from "express";
import crypto from "crypto";

interface SseClient {
  id: string;
  res: Response;
}

const clients = new Map<string, SseClient>();

export function addClient(id: string, res: Response): void {
  clients.set(id, { id, res });
  res.on("close", () => {
    clients.delete(id);
  });
}

export function broadcast(event: string, data: unknown): void {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [, client] of clients) {
    try {
      client.res.write(message);
    } catch {
      clients.delete(client.id);
    }
  }
}

export function handleSseRequest(_req: Request, res: Response): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const clientId = crypto.randomUUID();
  addClient(clientId, res);

  res.write(`:connected\n\n`);

  const keepalive = setInterval(() => {
    try {
      res.write(`:keepalive\n\n`);
    } catch {
      clearInterval(keepalive);
    }
  }, 30000);

  res.on("close", () => {
    clearInterval(keepalive);
    clients.delete(clientId);
  });
}
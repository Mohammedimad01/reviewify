"use client";
import type { Session } from "./types";

const KEY = "reviewify.sessions.v1";
const MAX_SESSIONS = 30;

function readAll(): Session[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as Session[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeAll(list: Session[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_SESSIONS)));
  } catch {
    // Quota exceeded: drop the oldest sessions and retry once.
    try {
      localStorage.setItem(KEY, JSON.stringify(list.slice(0, Math.max(1, Math.floor(list.length / 2)))));
    } catch {
      /* storage unavailable (private mode) — the app still works for this tab */
    }
  }
}

// In-memory mirror so the app keeps working when localStorage is blocked.
const memory = new Map<string, Session>();

export function listSessions(): Session[] {
  const stored = readAll();
  const ids = new Set(stored.map((s) => s.id));
  return [...stored, ...[...memory.values()].filter((s) => !ids.has(s.id))].sort((a, b) => b.createdAt - a.createdAt);
}

export function getSession(id: string): Session | undefined {
  return readAll().find((s) => s.id === id) ?? memory.get(id);
}

export function saveSession(session: Session) {
  memory.set(session.id, session);
  const list = readAll().filter((s) => s.id !== session.id);
  list.unshift(session);
  list.sort((a, b) => b.createdAt - a.createdAt);
  writeAll(list);
}

export function deleteSession(id: string) {
  memory.delete(id);
  writeAll(readAll().filter((s) => s.id !== id));
}

export function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

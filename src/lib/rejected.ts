import type { StatePatch } from '../types';

export type PendingOperation = { id: string; patch: StatePatch };
export type RejectedOperation = PendingOperation & { reason: string };
const prefix = 'vereda.rejected.v1.';

export function readRejected(userId: string): RejectedOperation[] {
  try {
    const value = JSON.parse(sessionStorage.getItem(`${prefix}${userId}`) || '[]');
    return Array.isArray(value) ? value.filter(item => typeof item?.id === 'string' && item.patch && typeof item.patch === 'object') : [];
  } catch { return []; }
}

export function retainRejected(userId: string, operation: PendingOperation, reason: string) {
  const entries = new Map(readRejected(userId).map(item => [item.id, item]));
  entries.set(operation.id, { ...operation, reason });
  sessionStorage.setItem(`${prefix}${userId}`, JSON.stringify([...entries.values()]));
}

export function removeRejected(userId: string, operationId: string) {
  const remaining = readRejected(userId).filter(item => item.id !== operationId);
  if (remaining.length) sessionStorage.setItem(`${prefix}${userId}`, JSON.stringify(remaining));
  else sessionStorage.removeItem(`${prefix}${userId}`);
}

// Bisect a refused batch so valid readings can still be confirmed. An atomic
// refusal is preserved separately instead of blocking every later operation.
export function dividePatch(patch: StatePatch): StatePatch[] {
  const fields = Object.entries(patch);
  const halves = <T,>(items: T[]) => [items.slice(0, Math.ceil(items.length / 2)), items.slice(Math.ceil(items.length / 2))];
  if (fields.length > 1) return halves(fields).map(items => Object.fromEntries(items) as StatePatch);
  const [field, value] = fields[0] ?? [];
  if (field === 'quizAttempts' && Array.isArray(value) && value.length > 1) {
    return halves(value).map(items => ({ quizAttempts: items }));
  }
  if (['completedChapters', 'completedLessons', 'preferences'].includes(field) && value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (entries.length > 1) return halves(entries).map(items => ({ [field]: Object.fromEntries(items) }) as StatePatch);
  }
  return [];
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProgressState, StatePatch, User } from '../types';

export const emptyState = (): ProgressState => ({ completedChapters: {}, completedLessons: {}, quizAttempts: [], preferences: { theme: 'light', fontSize: 18, speechRate: 1 }, selectedTrailId: null, lastReading: null });

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(typeof body.error === 'string' ? body.error : body.message || 'Não foi possível concluir. Tente novamente.'), { status: response.status });
  return body as T;
}

export function applyPatch(state: ProgressState, patch: StatePatch): ProgressState {
  const attempts = new Map(state.quizAttempts.map(attempt => [attempt.id, attempt]));
  patch.quizAttempts?.forEach(attempt => attempts.set(attempt.id, attempt));
  return {
    ...state, ...patch,
    completedChapters: { ...state.completedChapters, ...patch.completedChapters },
    completedLessons: { ...state.completedLessons, ...patch.completedLessons },
    preferences: { ...state.preferences, ...patch.preferences },
    quizAttempts: [...attempts.values()].slice(-500),
  };
}

type Operation = { id: string; patch: StatePatch };
type Snapshot = { user: User | null; state: ProgressState; queue: Operation[] };
const guestKey = 'vereda.guest.v1';
const pendingPrefix = 'vereda.pending.v2.';
const sessionSignal = 'vereda.session-change.v1';
const operationId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
const accountHeaders = (user: User) => ({ 'X-Vereda-Account': user.id });
const isSessionError = (error: unknown) => [401, 409].includes((error as { status?: number })?.status || 0);

function readGuest(): Snapshot {
  try {
    const raw = JSON.parse(localStorage.getItem(guestKey) || 'null');
    if (raw?.state && !raw.user) return { user: null, state: applyPatch(emptyState(), raw.state), queue: [] };
  } catch { /* Corrupt or unavailable storage must not expose a private account cache. */ }
  return { user: null, state: emptyState(), queue: [] };
}
function readPending(userId: string): Operation[] {
  try {
    const raw = JSON.parse(sessionStorage.getItem(`${pendingPrefix}${userId}`) || 'null');
    if (Array.isArray(raw?.queue)) return raw.queue.filter((item: Operation) => typeof item?.id === 'string' && item.patch && typeof item.patch === 'object');
  } catch { /* An account is loaded from the server; only its unsent operations need a tab-local queue. */ }
  return [];
}
function savePending(userId: string, queue: Operation[]) {
  const key = `${pendingPrefix}${userId}`;
  if (queue.length) sessionStorage.setItem(key, JSON.stringify({ queue }));
  else sessionStorage.removeItem(key);
}
function removeLegacyPrivateCaches() {
  const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
  for (const key of keys) if (key === 'vereda.active.v1' || key?.startsWith('vereda.account.')) localStorage.removeItem(key);
}
function initialGuest(): Snapshot {
  try {
    // Migrate an unsent queue from the previous version without retaining its profile or history.
    const previous = JSON.parse(localStorage.getItem('vereda.active.v1') || 'null');
    if (previous?.user?.id && Array.isArray(previous.queue) && previous.queue.length) {
      const existing = readPending(previous.user.id);
      const operations = new Map(existing.map(item => [item.id, item]));
      for (const item of previous.queue) if (typeof item?.id === 'string' && item.patch) operations.set(item.id, item);
      savePending(previous.user.id, [...operations.values()]);
    }
    if (!localStorage.getItem(guestKey) && previous?.state && !previous.user) localStorage.setItem(guestKey, JSON.stringify({ state: previous.state }));
    removeLegacyPrivateCaches();
  } catch { /* A subsequent write exposes the storage warning. */ }
  // Never render a private cached profile before confirming its server session.
  return readGuest();
}
function hasReadings(state: ProgressState) {
  return Object.values(state.completedChapters).some(Boolean) || Object.values(state.completedLessons).some(Boolean) || state.quizAttempts.length > 0 || Boolean(state.lastReading || state.selectedTrailId);
}
function guestImport(state: ProgressState): StatePatch {
  // Import affirmative progress; a guest must not undo progress already saved in the account.
  return {
    completedChapters: Object.fromEntries(Object.entries(state.completedChapters).filter(([, value]) => value)),
    completedLessons: Object.fromEntries(Object.entries(state.completedLessons).filter(([, value]) => value)),
    quizAttempts: state.quizAttempts,
    ...(state.lastReading ? { lastReading: state.lastReading } : {}),
    ...(state.selectedTrailId ? { selectedTrailId: state.selectedTrailId } : {}),
  };
}

export function useProgressStore() {
  const [snapshot, setSnapshot] = useState<Snapshot>(initialGuest);
  const current = useRef(snapshot);
  const flushing = useRef<Promise<void> | null>(null);
  const refreshing = useRef(false);
  const transitioning = useRef(false);
  const revision = useRef(0);
  const sessionGeneration = useRef(0);
  const [sessionCheck, setSessionCheck] = useState(0);
  const [status, setStatus] = useState<'checking' | 'local' | 'syncing' | 'synced' | 'offline'>('checking');
  const [storageWarning, setStorageWarning] = useState(false);
  const [accountNotice, setAccountNotice] = useState('');

  const commit = useCallback((value: Snapshot) => {
    current.current = value;
    setSnapshot(value);
    try {
      removeLegacyPrivateCaches();
      if (value.user) savePending(value.user.id, value.queue);
      else localStorage.setItem(guestKey, JSON.stringify({ state: value.state }));
    } catch { setStorageWarning(true); }
  }, []);
  const signalSessionChange = useCallback(() => {
    try { localStorage.setItem(sessionSignal, operationId()); }
    catch { setStorageWarning(true); }
  }, []);

  const flush = useCallback((): Promise<void> => {
    if (flushing.current) return flushing.current;
    if (!current.current.user || !current.current.queue.length) return Promise.resolve();
    const user = current.current.user;
    const generation = sessionGeneration.current;
    const operation = (async () => {
      try {
        while (current.current.queue.length && current.current.user?.id === user.id && generation === sessionGeneration.current) {
          setStatus('syncing');
          const item = current.current.queue[0];
          const result = await request<{ state: ProgressState; revision: number }>('/state', { method: 'PATCH', headers: accountHeaders(user), body: JSON.stringify(item.patch) });
          if (current.current.user?.id !== user.id || generation !== sessionGeneration.current) return;
          revision.current = Math.max(revision.current, result.revision);
          const queue = current.current.queue.filter(queued => queued.id !== item.id);
          commit({ ...current.current, state: queue.reduce((value, queued) => applyPatch(value, queued.patch), result.state), queue });
        }
        if (generation === sessionGeneration.current) setStatus(current.current.user ? 'synced' : 'local');
      } catch (error) {
        if (generation === sessionGeneration.current) {
          setStatus('offline');
          if (isSessionError(error)) setSessionCheck(value => value + 1);
        }
      }
    })();
    flushing.current = operation;
    void operation.finally(() => { if (flushing.current === operation) flushing.current = null; });
    return operation;
  }, [commit]);

  const refresh = useCallback(async () => {
    if (flushing.current || refreshing.current || transitioning.current) return;
    refreshing.current = true;
    const generation = sessionGeneration.current;
    try {
      const { user } = await request<{ user: User | null }>('/session');
      if (generation !== sessionGeneration.current || transitioning.current) return;
      if (!user) {
        if (current.current.user) {
          if (current.current.queue.length) setAccountNotice('Há leituras pendentes nesta aba. Entre novamente na mesma conta para sincronizá-las.');
          sessionGeneration.current += 1;
          commit(readGuest());
        }
        setStatus('local');
        return;
      }
      const result = await request<{ state: ProgressState; revision: number }>('/state', { headers: accountHeaders(user) });
      if (generation !== sessionGeneration.current || transitioning.current || flushing.current || (current.current.user?.id === user.id && result.revision < revision.current)) return;
      const sameAccount = current.current.user?.id === user.id;
      if (!sameAccount) {
        if (current.current.user?.id && current.current.queue.length) setAccountNotice('A conta mudou em outra aba. As leituras pendentes continuam separadas e só serão sincronizadas ao entrar na conta anterior.');
        sessionGeneration.current += 1;
      }
      revision.current = result.revision;
      const queue = sameAccount ? current.current.queue : readPending(user.id);
      commit({ user, state: queue.reduce((value, item) => applyPatch(value, item.patch), result.state), queue });
      setStatus(queue.length ? 'syncing' : 'synced');
      void flush();
    } catch { if (generation === sessionGeneration.current) setStatus('offline'); }
    finally { refreshing.current = false; }
  }, [commit, flush]);

  useEffect(() => {
    void refresh();
    const onFocus = () => { if (document.visibilityState === 'visible') void refresh(); };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== sessionSignal || transitioning.current) return;
      sessionGeneration.current += 1;
      commit(readGuest());
      setStatus('checking');
      setSessionCheck(value => value + 1);
    };
    window.addEventListener('online', onFocus);
    window.addEventListener('focus', onFocus);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onFocus);
    const interval = window.setInterval(onFocus, 20_000);
    return () => { window.clearInterval(interval); window.removeEventListener('online', onFocus); window.removeEventListener('focus', onFocus); window.removeEventListener('storage', onStorage); document.removeEventListener('visibilitychange', onFocus); };
  }, [refresh, commit]);
  useEffect(() => { if (sessionCheck) void refresh(); }, [sessionCheck, refresh]);

  const patch = useCallback((value: StatePatch) => {
    if (transitioning.current) { setAccountNotice('Aguarde a alteração de conta antes de registrar outra leitura.'); return; }
    const previous = current.current;
    const queue = previous.user ? [...previous.queue, { id: operationId(), patch: value }] : [];
    commit({ ...previous, state: applyPatch(previous.state, value), queue });
    setStatus(previous.user ? 'syncing' : 'local');
    void flush();
  }, [commit, flush]);

  const authenticate = useCallback(async (mode: 'login' | 'register', credentials: { name?: string; email: string; password: string }, importGuest = false) => {
    if (transitioning.current || current.current.user) throw new Error('Conclua a saída da conta atual antes de entrar em outra.');
    transitioning.current = true;
    const generation = ++sessionGeneration.current;
    const before = current.current;
    let importedId: string | null = null;
    try {
      const { user } = await request<{ user: User }>(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(credentials) });
      const result = await request<{ state: ProgressState; revision: number }>('/state', { headers: accountHeaders(user) });
      if (generation !== sessionGeneration.current) throw new Error('A sessão mudou. Entre novamente para continuar.');
      const queue = readPending(user.id);
      if (importGuest && hasReadings(before.state)) { importedId = operationId(); queue.push({ id: importedId, patch: guestImport(before.state) }); }
      revision.current = result.revision;
      setAccountNotice('');
      commit({ user, state: queue.reduce((value, item) => applyPatch(value, item.patch), result.state), queue });
      setStatus(queue.length ? 'syncing' : 'synced');
      signalSessionChange();
    } finally { transitioning.current = false; }
    await flush();
    // Clear only the imported readings after confirmation, keeping visitor comfort preferences.
    if (importedId && !current.current.queue.some(item => item.id === importedId) && JSON.stringify(readGuest().state) === JSON.stringify(before.state)) {
      try { localStorage.setItem(guestKey, JSON.stringify({ state: { ...emptyState(), preferences: before.state.preferences } })); }
      catch { setStorageWarning(true); }
    }
  }, [commit, flush, signalSessionChange]);

  const logout = useCallback(async () => {
    if (transitioning.current || !current.current.user) return;
    transitioning.current = true;
    const user = current.current.user;
    try {
      await flush();
      if (current.current.queue.length) throw new Error('Ainda há progresso aguardando sincronização. Conecte-se e tente sair novamente; sua sessão ainda não foi encerrada.');
      const generation = ++sessionGeneration.current;
      await request('/auth/logout', { method: 'POST', headers: accountHeaders(user), body: '{}' });
      if (generation !== sessionGeneration.current || current.current.user?.id !== user.id) return;
      try { savePending(user.id, []); removeLegacyPrivateCaches(); }
      catch { setStorageWarning(true); }
      revision.current = 0;
      commit(readGuest());
      setAccountNotice('');
      setStatus('local');
      signalSessionChange();
    } catch (error) {
      if (isSessionError(error)) setSessionCheck(value => value + 1);
      throw error;
    } finally { transitioning.current = false; }
  }, [commit, flush, signalSessionChange]);

  return { user: snapshot.user, progress: snapshot.state, patch, authenticate, logout, status, storageWarning, accountNotice, clearAccountNotice: () => setAccountNotice(''), hasGuestProgress: !snapshot.user && hasReadings(snapshot.state), refresh };
}

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAgentThread, type AgentThreadSummary, type GeneratedImageItem } from "@/lib/agent/use-agent-thread";

import { imageAssetRoot } from "./image-assets";
type Runtime = ReturnType<typeof useAgentThread>;
type Session = { threadId: string; projectThreadId: string; sourceFilename: string; assetFilename?: string; thread: AgentThreadSummary };
type Options = Parameters<typeof useAgentThread>[0];
function SessionRuntime({ session, options, onUpdate }: { session: Session; options: Options; onUpdate: (id: string, runtime: Runtime) => void }) {
  const runtime = useAgentThread(options);
  const load = useRef(runtime.loadThread);
  useEffect(() => { void load.current(session.thread); }, [session.threadId]);
  useEffect(() => { onUpdate(session.threadId, runtime); }, [session.threadId, onUpdate,
    runtime.threadId, runtime.status, runtime.loadingHistory, runtime.messages, runtime.images, runtime.activities,
    runtime.currentTurnId, runtime.error, runtime.pendingUserInput, runtime.answeringUserInput, runtime.compacting,
    runtime.interrupting, runtime.submit, runtime.respondToUserInput, runtime.interrupt]);
  return null;
}
export function useImageEditSessions(projectThreadId: string | null, options: Options, projectImages: readonly GeneratedImageItem[] = []) {
  const [copies, setCopies] = useState<Record<string, GeneratedImageItem[]>>({});
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.projectThreadId && detail.image?.filename) setCopies((current) => ({ ...current, [detail.projectThreadId]: [...(current[detail.projectThreadId] ?? []), detail.image] }));
    };
    window.addEventListener("commerce:image-copy", receive);
    return () => window.removeEventListener("commerce:image-copy", receive);
  }, []);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [runtimes, setRuntimes] = useState<Record<string, Runtime>>({});
  const [activeFilename, setActiveFilename] = useState<string | null>(null);
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const projectRef = useRef(projectThreadId);
  projectRef.current = projectThreadId;
  const requests = useRef(new Map<string, Promise<void>>());
  const onUpdate = useCallback((id: string, runtime: Runtime) => setRuntimes((current) => ({ ...current, [id]: runtime })), []);
  useEffect(() => {
    setActiveFilename(null); setError(null);
    if (!projectThreadId) { setCopies({}); setSessions([]); setRuntimes({}); setBindings({}); return; }
    let alive = true;
    async function refresh() {
      try {
        const response = await fetch(`/api/agent/threads/${encodeURIComponent(projectThreadId!)}/image-sessions`, { cache: "no-store" });
        const payload = await response.json();
        if (!alive) return;
        if (!response.ok) throw new Error(payload.error ?? "无法恢复图片编辑会话。");
        setSessions((current) => {
          const additions = (payload.sessions as Session[]).filter((item) => !current.some((existing) => existing.threadId === item.threadId));
          const updates = new Map((payload.sessions as Session[]).map((item) => [item.threadId, item]));
          const changed = current.some((item) => updates.has(item.threadId) && updates.get(item.threadId)?.assetFilename !== item.assetFilename);
          return additions.length || changed ? [...current.map((item) => updates.get(item.threadId) ?? item), ...additions] : current;
        });
      } catch (error) { if (alive) setError(error instanceof Error ? error.message : "无法恢复图片编辑会话。"); }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 10_000);
    return () => { alive = false; clearInterval(timer); };
  }, [projectThreadId]);
  const activate = useCallback((filename: string) => {
    setActiveFilename(filename);
    if (!projectThreadId) return;
    const root = imageAssetRoot(filename, [...projectImages, ...Object.values(runtimes).flatMap((runtime) => runtime.images), ...Object.values(copies).flat()]);
    const known = sessions.find((session) => session.projectThreadId === projectThreadId && (session.assetFilename ?? session.sourceFilename) === root);
    if (known && runtimes[known.threadId]?.status === "running") { setBindings((current) => ({ ...current, [filename]: known.threadId })); return; }
    const key = `${projectThreadId}:${filename}`;
    if (requests.current.has(key)) return;
    setError(null);
    const operation = (async () => {
      try {
        const response = await fetch(`/api/agent/threads/${encodeURIComponent(projectThreadId)}/image-sessions`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename, model: options.model }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.session?.thread) throw new Error(payload.error ?? "无法打开图片编辑会话。");
        if (projectRef.current !== projectThreadId) return;
        const session = payload.session as Session;
        if (payload.session.replacedEmptyThreadId) {
          setSessions((current) => current.filter((item) => item.threadId !== payload.session.replacedEmptyThreadId));
          setRuntimes((current) => { const next = { ...current }; delete next[payload.session.replacedEmptyThreadId]; return next; });
        }
        setSessions((current) => current.some((item) => item.threadId === session.threadId) ? current.map((item) => item.threadId === session.threadId ? session : item) : [...current, session]);
        setBindings((current) => ({ ...current, [filename]: session.threadId }));
      } catch (error) { if (projectRef.current === projectThreadId) setError(error instanceof Error ? error.message : "无法打开图片编辑会话。"); }
      finally { requests.current.delete(key); }
    })();
    requests.current.set(key, operation);
  }, [projectThreadId, sessions, runtimes, options.model, projectImages, copies]);
  const currentSessions = sessions.filter((session) => session.projectThreadId === projectThreadId);
  const activeId = activeFilename ? bindings[activeFilename] ?? currentSessions.find((session) => session.sourceFilename === activeFilename)?.threadId : undefined;
  const active = activeId ? runtimes[activeId] : undefined;
  const ready = Boolean(active && active.threadId === activeId && !active.loadingHistory && active.status !== "connecting");
  const images = [...currentSessions.flatMap((session) => runtimes[session.threadId]?.images ?? []), ...(projectThreadId ? copies[projectThreadId] ?? [] : [])];
  const editingFilenames = currentSessions.flatMap((session) => {
    const runtime = runtimes[session.threadId];
    if (!runtime || !["running", "connecting"].includes(runtime.status) || runtime.loadingHistory) return [];
    const lastRequest = [...runtime.messages].reverse().find((message) => message.role === "user");
    return [lastRequest?.content.match(/^批注原图：(.+)$/m)?.[1] ?? session.sourceFilename];
  });
  const activeSession = currentSessions.find((session) => session.threadId === activeId);
  const olderRuntimes = activeSession ? currentSessions.filter((session) => session.threadId !== activeId && (session.assetFilename ?? session.sourceFilename) === (activeSession.assetFilename ?? activeSession.sourceFilename)).map((session) => runtimes[session.threadId]).filter((runtime): runtime is Runtime => Boolean(runtime)) : [];
  return { activate, active, olderRuntimes, activeFilename, ready, error, images, editingFilenames, sessions: currentSessions, runtimes,
    controllers: sessions.map((session) => <SessionRuntime key={session.threadId} session={session} options={options} onUpdate={onUpdate} />) };
}

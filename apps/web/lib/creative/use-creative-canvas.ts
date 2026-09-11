"use client";

import { useCreativeCanvasNavigation } from "./creative-canvas-navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  CreativeCanvasLayout,
  CreativeCanvasNodeContent,
  CreativeCanvasNodeRecord,
  CreativeCanvasState,
  CreativeCanvasViewport,
} from "./creative-canvas-types";

export function useCreativeCanvas({
  threadId,
  sourceSignature,
  running = false,
}: {
  threadId: string | null;
  sourceSignature: string;
  running?: boolean;
}) {
  const [state, setState] = useState<CreativeCanvasState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingNodeIds, setSavingNodeIds] = useState<ReadonlySet<string>>(() => new Set());
  const requestGeneration = useRef(0);
  const localSnapshots = useRef(new Map<string, CreativeCanvasState>());
  const navigation = useCreativeCanvasNavigation();
  const snapshots = { current: navigation?.canvasSnapshots ?? localSnapshots.current };

  const inFlight = useRef<{ threadId: string; queued: boolean; promise: Promise<void> } | null>(null);

  const load = useCallback((): Promise<void> => {
    if (!threadId) {
      setState(null);
      setError(null);
      setLoading(false);
      return Promise.resolve();
    }
    if (inFlight.current?.threadId === threadId) {
      inFlight.current.queued = true;
      return inFlight.current.promise;
    }
    const request = { threadId, queued: false, promise: Promise.resolve() };
    inFlight.current = request;
    setLoading(true);
    request.promise = (async () => {
      do {
        request.queued = false;
        const generation = ++requestGeneration.current;
        try {
          const response = await fetch(`/api/agent/threads/${encodeURIComponent(threadId)}/canvas`, {
            cache: "no-store",
            signal: AbortSignal.timeout(20_000),
          });
          const payload = (await response.json().catch(() => null)) as (CreativeCanvasState & { error?: string }) | null;
          if (!response.ok || !payload) throw new Error(payload?.error || "无法读取创作画布。");
          if (requestGeneration.current !== generation || inFlight.current !== request) return;
          snapshots.current.delete(threadId);
          snapshots.current.set(threadId, payload);
          while (snapshots.current.size > 12) snapshots.current.delete(snapshots.current.keys().next().value!);
          setState(payload);
          setError(null);
        } catch (loadError) {
          if (requestGeneration.current !== generation || inFlight.current !== request) return;
          setError(loadError instanceof Error && loadError.name === "TimeoutError"
            ? "画布同步超时，请点击刷新重试。"
            : loadError instanceof Error ? loadError.message : "无法读取创作画布。");
        }
      } while (request.queued && inFlight.current === request);
    })().finally(() => {
      if (inFlight.current === request) {
        inFlight.current = null;
        setLoading(false);
      }
    });
    return request.promise;
  }, [threadId]);

  useEffect(() => {
    if (!threadId) snapshots.current.clear();
    setState(threadId ? snapshots.current.get(threadId) ?? null : null);
    setError(null);
    return () => {
      requestGeneration.current += 1;
      inFlight.current = null;
    };
  }, [threadId]);

  useEffect(() => {
    void load();
  }, [load, sourceSignature, running]);

  const saveNodeContent = useCallback(async (nodeId: string, content: CreativeCanvasNodeContent) => {
    if (!threadId) return null;
    setSavingNodeIds((current) => new Set(current).add(nodeId));
    try {
      const response = await fetch(
        `/api/agent/threads/${encodeURIComponent(threadId)}/canvas/nodes/${encodeURIComponent(nodeId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: editableContent(content) }),
        },
      );
      const payload = (await response.json().catch(() => null)) as { node?: CreativeCanvasNodeRecord; error?: string } | null;
      if (!response.ok || !payload?.node) throw new Error(payload?.error || "无法保存画布内容。");
      setState((current) => current ? {
        ...current,
        nodes: current.nodes.map((node) => node.id === nodeId ? payload.node as CreativeCanvasNodeRecord : node),
        messageRefs: current.messageRefs.map((ref) =>
          ref.nodeId === nodeId ? { ...ref, title: payload.node?.title ?? ref.title } : ref),
      } : current);
      setError(null);
      return payload.node;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "无法保存画布内容。");
      return null;
    } finally {
      setSavingNodeIds((current) => {
        const next = new Set(current);
        next.delete(nodeId);
        return next;
      });
    }
  }, [threadId]);

  const saveNodeLayout = useCallback(async (nodeId: string, layout: CreativeCanvasLayout) => {
    if (!threadId) return;
    setState((current) => current ? {
      ...current,
      nodes: current.nodes.map((node) => node.id === nodeId ? { ...node, layout } : node),
    } : current);
    try {
      const response = await fetch(
        `/api/agent/threads/${encodeURIComponent(threadId)}/canvas/nodes/${encodeURIComponent(nodeId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ layout }),
        },
      );
      const payload = (await response.json().catch(() => null)) as { node?: CreativeCanvasNodeRecord; error?: string } | null;
      if (!response.ok || !payload?.node) throw new Error(payload?.error || "无法保存节点位置。");
      setState((current) => current ? {
        ...current,
        nodes: current.nodes.map((node) => node.id === nodeId ? payload.node as CreativeCanvasNodeRecord : node),
      } : current);
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "无法保存节点位置。");
      void load();
    }
  }, [load, threadId]);

  const restoreNodeRevision = useCallback(async (nodeId: string, revisionId: string) => {
    if (!threadId) return null;
    setSavingNodeIds((current) => new Set(current).add(nodeId));
    try {
      const response = await fetch(
        `/api/agent/threads/${encodeURIComponent(threadId)}/canvas/nodes/${encodeURIComponent(nodeId)}/revisions/${encodeURIComponent(revisionId)}/restore`,
        { method: "POST" },
      );
      const payload = (await response.json().catch(() => null)) as { node?: CreativeCanvasNodeRecord; error?: string } | null;
      if (!response.ok || !payload?.node) throw new Error(payload?.error || "无法恢复画布版本。");
      setState((current) => current ? {
        ...current,
        nodes: current.nodes.map((node) => node.id === nodeId ? payload.node as CreativeCanvasNodeRecord : node),
        messageRefs: current.messageRefs.map((ref) =>
          ref.nodeId === nodeId ? { ...ref, title: payload.node?.title ?? ref.title } : ref),
      } : current);
      setError(null);
      return payload.node;
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "无法恢复画布版本。");
      return null;
    } finally {
      setSavingNodeIds((current) => {
        const next = new Set(current);
        next.delete(nodeId);
        return next;
      });
    }
  }, [threadId]);

  const saveViewport = useCallback(async (viewport: CreativeCanvasViewport) => {
    if (!threadId) return;
    setState((current) => current ? { ...current, viewport } : current);
    try {
      const response = await fetch(
        `/api/agent/threads/${encodeURIComponent(threadId)}/canvas/viewport`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(viewport),
        },
      );
      if (!response.ok) throw new Error("无法保存画布视口。");
    } catch {
      // Viewport persistence is best effort; node content and layout errors stay visible.
    }
  }, [threadId]);

  return {
    state,
    loading,
    error,
    savingNodeIds,
    refresh: load,
    saveNodeContent,
    saveNodeLayout,
    restoreNodeRevision,
    saveViewport,
  };
}

function editableContent(content: CreativeCanvasNodeContent) {
  if (content.kind !== "image") return content;
  return {
    kind: content.kind,
    title: content.title,
    description: content.description,
    textLayers: content.textLayers,
    complianceNotes: content.complianceNotes,
  };
}

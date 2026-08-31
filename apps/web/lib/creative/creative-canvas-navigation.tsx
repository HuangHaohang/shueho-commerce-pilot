"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { CreativeCanvasMessageReference } from "./creative-canvas-types";

type CanvasFocusRequest = { nodeId: string; nonce: number } | null;
export type CanvasRevisionRequest = {
  nodeId: string;
  title: string;
  nodeType: CreativeCanvasMessageReference["nodeType"];
  deliverableType: string | null;
  nonce: number;
} | null;

type CreativeCanvasNavigationContextValue = {
  focusRequest: CanvasFocusRequest;
  revisionRequest: CanvasRevisionRequest;
  requestCanvasFocus: (nodeId: string) => void;
  requestNodeRevision: (node: Omit<NonNullable<CanvasRevisionRequest>, "nonce">) => void;
  focusConversationMessage: (messageItemId: string) => void;
  registerConversationMessage: (messageItemId: string, element: HTMLElement | null) => void;
  refsForMessage: (messageItemId: string) => CreativeCanvasMessageReference[];
  publishMessageRefs: (refs: CreativeCanvasMessageReference[]) => void;
};

const CreativeCanvasNavigationContext = createContext<CreativeCanvasNavigationContextValue | null>(null);

export function CreativeCanvasNavigationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [focusRequest, setFocusRequest] = useState<CanvasFocusRequest>(null);
  const [revisionRequest, setRevisionRequest] = useState<CanvasRevisionRequest>(null);
  const [messageRefs, setMessageRefs] = useState<CreativeCanvasMessageReference[]>([]);
  const messageElements = useRef(new Map<string, HTMLElement>());
  const nonceRef = useRef(0);

  const requestCanvasFocus = useCallback((nodeId: string) => {
    nonceRef.current += 1;
    setFocusRequest({ nodeId, nonce: nonceRef.current });
  }, []);
  const requestNodeRevision = useCallback((node: Omit<NonNullable<CanvasRevisionRequest>, "nonce">) => {
    nonceRef.current += 1;
    setRevisionRequest({ ...node, nonce: nonceRef.current });
  }, []);

  const registerConversationMessage = useCallback((messageItemId: string, element: HTMLElement | null) => {
    if (element) messageElements.current.set(messageItemId, element);
    else messageElements.current.delete(messageItemId);
  }, []);

  const focusConversationMessage = useCallback((messageItemId: string) => {
    const element = messageElements.current.get(messageItemId);
    if (!element) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
    if (reducedMotion || typeof element.animate !== "function") return;
    element.animate(
      [
        { backgroundColor: "transparent" },
        { backgroundColor: "var(--cp-bg-subtle)" },
        { backgroundColor: "transparent" },
      ],
      { duration: 700, easing: "ease-out" },
    );
  }, []);

  const refsByMessage = useMemo(() => {
    const grouped = new Map<string, CreativeCanvasMessageReference[]>();
    for (const ref of messageRefs) {
      const current = grouped.get(ref.messageItemId) ?? [];
      current.push(ref);
      grouped.set(ref.messageItemId, current);
    }
    return grouped;
  }, [messageRefs]);

  const refsForMessage = useCallback(
    (messageItemId: string) => refsByMessage.get(messageItemId) ?? [],
    [refsByMessage],
  );
  const publishMessageRefs = useCallback((refs: CreativeCanvasMessageReference[]) => {
    setMessageRefs(refs);
  }, []);

  const value = useMemo<CreativeCanvasNavigationContextValue>(() => ({
    focusRequest,
    revisionRequest,
    requestCanvasFocus,
    requestNodeRevision,
    focusConversationMessage,
    registerConversationMessage,
    refsForMessage,
    publishMessageRefs,
  }), [
    focusConversationMessage,
    focusRequest,
    revisionRequest,
    refsForMessage,
    registerConversationMessage,
    requestCanvasFocus,
    requestNodeRevision,
    publishMessageRefs,
  ]);

  return (
    <CreativeCanvasNavigationContext.Provider value={value}>
      {children}
    </CreativeCanvasNavigationContext.Provider>
  );
}

export function useCreativeCanvasNavigation() {
  return useContext(CreativeCanvasNavigationContext);
}

export function CreativeCanvasComposerBridge({
  onRequest,
}: {
  onRequest: (request: NonNullable<CanvasRevisionRequest>) => void;
}) {
  const navigation = useCreativeCanvasNavigation();
  const handledNonceRef = useRef(0);
  useEffect(() => {
    const request = navigation?.revisionRequest;
    if (!request || handledNonceRef.current === request.nonce) return;
    handledNonceRef.current = request.nonce;
    onRequest(request);
  }, [navigation?.revisionRequest, onRequest]);
  return null;
}

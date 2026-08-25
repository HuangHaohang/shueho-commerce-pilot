"use client";

import { Check, ChevronRight, FileUp, ImageIcon, Loader2, Search, WandSparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";

import {
  readSkillMention,
  removeSkillMention,
  type SkillMention,
} from "@/lib/agent/skill-invocation";
import type { SkillInventoryItem } from "@/lib/agent/skills";
import type { CommercePluginInventoryItem } from "@/lib/plugins/catalog";
import { cn } from "@/lib/utils";

type SkillMenuState =
  | { source: "button"; query: "" }
  | ({ source: "mention" } & SkillMention);

export function useComposerSkillSelector({
  value,
  skills,
  selectedSkill,
  disabled,
  inputRef,
  rootRef,
  onChange,
  onSelect,
}: {
  value: string;
  skills: SkillInventoryItem[];
  selectedSkill: SkillInventoryItem | null;
  disabled: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  rootRef: RefObject<HTMLElement | null>;
  onChange: (value: string) => void;
  onSelect: (skill: SkillInventoryItem) => void;
}) {
  const [menu, setMenu] = useState<SkillMenuState | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const enabledSkills = useMemo(() => skills.filter((skill) => skill.enabled), [skills]);
  const filteredSkills = useMemo(() => {
    const query = menu?.query.trim().toLocaleLowerCase("zh-CN") ?? "";
    if (!query) return enabledSkills;
    return enabledSkills.filter((skill) =>
      [skill.name, skill.displayName, skill.shortDescription, skill.description]
        .join(" ")
        .toLocaleLowerCase("zh-CN")
        .includes(query),
    );
  }, [enabledSkills, menu?.query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [menu?.query]);

  useEffect(() => {
    if (!menu) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenu(null);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [menu, rootRef]);

  const selectSkill = useCallback((skill: SkillInventoryItem) => {
    let nextValue = value;
    let nextCursor = value.length;
    if (menu?.source === "mention") {
      nextValue = removeSkillMention(value, menu);
      nextCursor = menu.start;
      onChange(nextValue);
    }
    onSelect(skill);
    setMenu(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  }, [inputRef, menu, onChange, onSelect, value]);

  const handleChange = useCallback((nextValue: string, cursor: number) => {
    onChange(nextValue);
    if (disabled) {
      setMenu(null);
      return;
    }
    const mention = readSkillMention(nextValue, cursor);
    setMenu(mention ? { source: "mention", ...mention } : null);
  }, [disabled, onChange]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!menu) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      setMenu(null);
      return true;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => {
        if (!filteredSkills.length) return 0;
        const delta = event.key === "ArrowDown" ? 1 : -1;
        return (current + delta + filteredSkills.length) % filteredSkills.length;
      });
      return true;
    }
    if (event.key === "Enter" && filteredSkills[activeIndex]) {
      event.preventDefault();
      selectSkill(filteredSkills[activeIndex]);
      return true;
    }
    return false;
  }, [activeIndex, filteredSkills, menu, selectSkill]);

  return {
    open: Boolean(menu),
    source: menu?.source ?? null,
    query: menu?.query ?? "",
    filteredSkills,
    activeIndex,
    selectedSkill,
    handleChange,
    handleKeyDown,
    selectSkill,
    setActiveIndex,
    toggleMenu: () => {
      if (disabled) return;
      setMenu((current) => current ? null : { source: "button", query: "" });
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    closeMenu: () => setMenu(null),
  };
}

export function ComposerAddMenu({
  open,
  placement = "above",
  source,
  query,
  plugins,
  pluginsLoading,
  skills,
  activeIndex,
  loading,
  selectedSkill,
  onSelect,
  onActiveIndexChange,
  onOpenPlugin,
  onAddFiles,
}: {
  open: boolean;
  placement?: "above" | "below";
  source: "button" | "mention" | null;
  query: string;
  plugins: CommercePluginInventoryItem[];
  pluginsLoading: boolean;
  skills: SkillInventoryItem[];
  activeIndex: number;
  loading: boolean;
  selectedSkill: SkillInventoryItem | null;
  onSelect: (skill: SkillInventoryItem) => void;
  onActiveIndexChange: (index: number) => void;
  onOpenPlugin: (plugin: CommercePluginInventoryItem) => void;
  onAddFiles: () => void;
}) {
  if (!open) return null;
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const visiblePlugins = normalizedQuery
    ? plugins.filter((plugin) =>
        [
          plugin.manifest.name,
          plugin.manifest.interface.displayName,
          plugin.manifest.interface.shortDescription,
        ]
          .join(" ")
          .toLocaleLowerCase("zh-CN")
          .includes(normalizedQuery),
      )
    : plugins;
  return (
    <div
      className={cn(
        "absolute left-0 z-50 w-full overflow-hidden rounded-[var(--cp-radius-panel)] border border-[var(--cp-border)] bg-[var(--cp-surface)] p-1.5 shadow-[var(--cp-shadow-popover)]",
        placement === "above" ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]",
      )}
      role="menu"
      aria-label="添加内容"
    >
      <div className="cp-flat-scrollbar max-h-[320px] overflow-y-auto overscroll-contain">
        {source === "button" && !normalizedQuery ? (
          <MenuSection label="添加">
            <button
              type="button"
              role="menuitem"
              className="grid h-10 w-full grid-cols-[24px_minmax(0,1fr)_18px] items-center gap-2 rounded-[var(--cp-radius-item)] px-2 text-left hover:bg-[var(--cp-bg-subtle)]"
              onClick={onAddFiles}
            >
              <FileUp className="size-4 justify-self-center text-[var(--cp-text-soft)]" strokeWidth={1.8} />
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 text-sm font-medium text-[var(--cp-text)]">文件和图片</span>
                <span className="truncate text-xs text-[var(--cp-text-muted)]">PDF、DOCX、XLSX、文本和照片</span>
              </span>
              <ChevronRight className="size-3.5 text-[var(--cp-text-faint)]" />
            </button>
          </MenuSection>
        ) : null}

        <MenuSection label="插件">
          {pluginsLoading ? (
            <MenuLoading label="正在读取插件" />
          ) : visiblePlugins.length ? (
            visiblePlugins.map((plugin) => {
              const Icon = plugin.manifest.interface.icon === "search" ? Search : ImageIcon;
              return (
                <button
                  key={plugin.manifest.name}
                  type="button"
                  role="menuitem"
                  className="grid h-10 w-full grid-cols-[24px_minmax(0,1fr)_18px] items-center gap-2 rounded-[var(--cp-radius-item)] px-2 text-left hover:bg-[var(--cp-bg-subtle)]"
                  onClick={() => onOpenPlugin(plugin)}
                >
                  <span className={cn(
                    "flex size-6 items-center justify-center rounded-[6px] border border-[var(--cp-border-subtle)]",
                    plugin.manifest.interface.icon === "search"
                      ? "bg-[#e9f6f2] text-[#176c5a]"
                      : "bg-[#fff0eb] text-[#a74736]",
                  )}>
                    <Icon className="size-3.5" strokeWidth={1.8} />
                  </span>
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="shrink-0 truncate text-sm font-medium text-[var(--cp-text)]">
                      {plugin.manifest.interface.displayName}
                    </span>
                    <span className="min-w-0 truncate text-xs text-[var(--cp-text-muted)]">
                      {plugin.manifest.interface.shortDescription}
                    </span>
                  </span>
                  <ChevronRight className="size-3.5 text-[var(--cp-text-faint)]" />
                </button>
              );
            })
          ) : (
            <MenuEmpty label="没有匹配的插件" />
          )}
        </MenuSection>

        <MenuSection label="技能">
          {loading ? (
            <MenuLoading label="正在读取技能" />
          ) : skills.length ? (
            skills.map((skill, index) => (
              <button
                key={`${skill.scope}:${skill.name}`}
                type="button"
                role="menuitemradio"
                aria-checked={selectedSkill?.name === skill.name}
                className={cn(
                  "grid h-10 w-full grid-cols-[24px_minmax(0,1fr)_18px] items-center gap-2 rounded-[var(--cp-radius-item)] px-2 text-left",
                  index === activeIndex ? "bg-[var(--cp-bg-muted)]" : "hover:bg-[var(--cp-bg-subtle)]",
                )}
                onPointerMove={() => onActiveIndexChange(index)}
                onClick={() => onSelect(skill)}
              >
                <span className="flex size-6 items-center justify-center rounded-[6px] border border-[var(--cp-border-subtle)] bg-[#f2edff] text-[#6750a4]">
                  <WandSparkles className="size-3.5" strokeWidth={1.8} />
                </span>
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="shrink-0 truncate text-sm font-medium text-[var(--cp-text)]">{skill.displayName}</span>
                  <span className="min-w-0 truncate text-xs text-[var(--cp-text-muted)]">
                    {skill.shortDescription || skill.description}
                  </span>
                </span>
                {selectedSkill?.name === skill.name ? <Check className="size-4 text-[var(--cp-success)]" /> : null}
              </button>
            ))
          ) : (
            <MenuEmpty label="没有匹配的技能" />
          )}
        </MenuSection>
      </div>
      <div className="mt-1 border-t border-[var(--cp-border-subtle)] px-2 pt-1.5 text-[11px] leading-5 text-[var(--cp-text-faint)]">
        {source === "mention" ? "继续输入可筛选插件和技能，回车选择技能" : "输入 @ 可直接筛选插件和技能"}
      </div>
    </div>
  );
}

function MenuSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label}>
      <div className="px-2 pb-0.5 pt-1 text-[11px] font-medium leading-5 text-[var(--cp-text-faint)]">{label}</div>
      {children}
    </section>
  );
}

function MenuLoading({ label }: { label: string }) {
  return (
    <div className="flex h-10 items-center gap-2 px-2 text-sm text-[var(--cp-text-muted)]">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}

function MenuEmpty({ label }: { label: string }) {
  return <div className="px-2 py-2 text-xs text-[var(--cp-text-muted)]">{label}</div>;
}

export function SelectedSkillChip({
  skill,
  inverse = false,
  inlineMessage = false,
  onRemove,
}: {
  skill: SkillInventoryItem | { name: string; displayName?: string };
  inverse?: boolean;
  inlineMessage?: boolean;
  onRemove?: () => void;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 text-xs font-medium",
        inlineMessage
          ? inverse
            ? "mr-1.5 align-[-2px] text-[#d8cbff]"
            : "mr-1.5 align-[-2px] text-[#6750a4]"
          : inverse
            ? "h-7 rounded-full bg-white/15 px-2.5 text-white"
            : "h-7 rounded-full border border-[#ddd5f5] bg-[#f5f1ff] px-2.5 text-[#5f469c]",
      )}
      data-selected-skill={skill.name}
    >
      <WandSparkles className="size-3.5 shrink-0" strokeWidth={1.9} />
      <span className="truncate">{inlineMessage ? "" : "@"}{skill.displayName || skill.name}</span>
      {onRemove ? (
        <button
          type="button"
          className={cn(
            "-mr-1 flex size-5 shrink-0 items-center justify-center rounded-full",
            inverse ? "hover:bg-white/15" : "hover:bg-[#e9e1fb]",
          )}
          aria-label={`移除技能 ${skill.displayName || skill.name}`}
          onClick={onRemove}
        >
          <X className="size-3" />
        </button>
      ) : null}
    </span>
  );
}

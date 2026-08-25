const explicitSkillMarker = /^\$([a-z0-9]+(?:-[a-z0-9]+)*)[ \t]*(?:\r?\n|$)/;

export type ExplicitSkillMessage = {
  content: string;
  skillName: string | null;
};

export function readExplicitSkillMessage(value: string): ExplicitSkillMessage {
  const match = value.match(explicitSkillMarker);
  if (!match) return { content: value.trim(), skillName: null };
  return {
    content: value.slice(match[0].length).trim(),
    skillName: match[1] ?? null,
  };
}

export function readVisibleAttachmentMessage(value: string): string {
  return value
    .replace(/\n?<commerce_attachment_context\b[\s\S]*$/i, "")
    .replace(/^\[附件：[^\]\r\n]*\]\s*/u, "")
    .trim();
}

export type SkillMention = {
  start: number;
  end: number;
  query: string;
};

export function readSkillMention(value: string, cursor: number): SkillMention | null {
  const beforeCursor = value.slice(0, Math.max(0, cursor));
  const match = beforeCursor.match(/(?:^|\s)@([^@\s]*)$/);
  if (!match) return null;
  const query = match[1] ?? "";
  return {
    start: beforeCursor.length - query.length - 1,
    end: beforeCursor.length,
    query,
  };
}

export function removeSkillMention(value: string, mention: SkillMention): string {
  const prefix = value.slice(0, mention.start);
  let suffix = value.slice(mention.end);
  if (/\s$/.test(prefix) && /^\s/.test(suffix)) suffix = suffix.slice(1);
  return `${prefix}${suffix}`;
}

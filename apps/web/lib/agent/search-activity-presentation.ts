type SearchActivity = {
  kind: string;
  status: "running" | "completed" | "failed";
  sources?: unknown[];
};

export function searchActivityLabel(activity: SearchActivity): string | null {
  if (activity.kind !== "search") return null;
  if (activity.status === "running") return "正在搜索";
  if (activity.status === "failed") return "搜索未完成";
  const sourceCount = activity.sources?.length ?? 0;
  return sourceCount ? `${sourceCount} 个来源` : "未返回可用来源";
}

export function summarizeSearchActivities(activities: SearchActivity[]): string | null {
  const searches = activities.filter((activity) => activity.kind === "search");
  if (!searches.length) return null;
  if (searches.some((activity) => activity.status === "running")) return "正在搜索网页";
  const failed = searches.filter((activity) => activity.status === "failed").length;
  return `完成了 ${searches.length} 次搜索${failed ? ` · ${failed} 次未完成` : ""}`;
}

export function billingPeriodStart(anchorDay: number, now = new Date()): Date {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const currentAnchor = new Date(Date.UTC(year, month, anchorDay));
  return now >= currentAnchor ? currentAnchor : new Date(Date.UTC(year, month - 1, anchorDay));
}

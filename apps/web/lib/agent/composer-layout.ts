export const COMPACT_COMPOSER_CONTROLS_MAX_WIDTH = 430;

export function shouldCompactComposerControls(width: number): boolean {
  return Number.isFinite(width) && width > 0 && width <= COMPACT_COMPOSER_CONTROLS_MAX_WIDTH;
}

"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as React from "react";

import { DialogLayerContext } from "./dialog";

import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 8, style, ...props }, ref) => {
  const dialogLayer = React.useContext(DialogLayerContext);
  return (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      style={{ zIndex: Math.max(70, dialogLayer + 1), ...style }}
      sideOffset={sideOffset}
      className={cn(
        "z-50 overflow-hidden rounded-[var(--cp-radius-item)] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-2.5 py-1.5 text-xs text-[var(--cp-text-soft)] shadow-[var(--cp-shadow-popover)]",
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
);
});
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };

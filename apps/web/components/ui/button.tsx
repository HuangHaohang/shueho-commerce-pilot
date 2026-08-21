import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--cp-radius-control)] text-sm font-medium transition-[background,border-color,color,box-shadow] duration-[var(--cp-duration-fast)] ease-[var(--cp-ease-standard)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--cp-bg)] disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-[var(--cp-text)] text-[var(--cp-text-inverse)] hover:bg-[var(--cp-text-soft)]",
        subtle: "bg-[var(--cp-bg-subtle)] text-[var(--cp-text)] hover:bg-[var(--cp-surface-hover)]",
        ghost: "bg-transparent text-[var(--cp-text-soft)] hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)]",
        outline:
          "border border-[var(--cp-border)] bg-[var(--cp-surface)] text-[var(--cp-text)] hover:bg-[var(--cp-bg-subtle)]",
        destructive: "bg-[var(--cp-danger)] text-[var(--cp-text-inverse)] hover:brightness-95",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-9 px-3.5",
        lg: "h-10 px-4",
        icon: "size-9 p-0",
        composerIcon: "size-[var(--cp-composer-action-size)] p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";

    return <Comp ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };

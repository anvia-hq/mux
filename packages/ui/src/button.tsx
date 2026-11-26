import { Button as BaseButton } from "@base-ui/react/button";
import type { ComponentPropsWithoutRef } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
type ButtonSize = "sm" | "md";

export interface ButtonProps extends ComponentPropsWithoutRef<typeof BaseButton> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANT_STYLES: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:opacity-90 border border-transparent",
  secondary: "bg-secondary text-secondary-foreground hover:bg-accent border border-border",
  ghost:
    "bg-transparent text-muted-foreground hover:text-foreground hover:bg-accent border border-transparent",
  destructive:
    "bg-destructive text-destructive-foreground hover:opacity-90 border border-transparent",
};

const SIZE_STYLES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-9 px-4 text-sm gap-2",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <BaseButton
      {...props}
      className={`inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 cursor-pointer ${VARIANT_STYLES[variant]} ${SIZE_STYLES[size]} ${className}`}
    />
  );
}

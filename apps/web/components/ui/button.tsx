import clsx from "clsx";
import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-sm)] font-bold transition-all active:translate-x-[1px] active:translate-y-[1px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-x-0 disabled:active:translate-y-0";

const variants: Record<ButtonVariant, string> = {
  primary:
    "border-[1.5px] border-[var(--line-strong)] bg-[var(--accent)] text-white shadow-[2px_2px_0_var(--line-strong)] hover:bg-[var(--accent-bright)]",
  secondary:
    "border-[1.5px] border-[var(--line-strong)] bg-[var(--surface)] text-[var(--ink)] shadow-[2px_2px_0_var(--surface-soft)] hover:bg-[var(--surface-soft)]",
  ghost: "text-[var(--ink)] hover:bg-[var(--surface-soft)]",
  destructive:
    "border-[1.5px] border-[var(--line-strong)] bg-[var(--danger)] text-white shadow-[2px_2px_0_var(--line-strong)] hover:opacity-90",
};

const sizes: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

export function buttonVariants({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}) {
  return clsx(base, variants[variant], sizes[size], className);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={buttonVariants({ variant, size, className })} type={type} {...props} />;
}

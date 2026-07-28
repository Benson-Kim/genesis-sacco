"use client";

import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Prototype variants: default (outlined), `p` (primary navy), `g` (emerald). */
  variant?: "default" | "primary" | "success";
}

const variantClass: Record<NonNullable<ButtonProps["variant"]>, string> = {
  default: "",
  primary: styles.primary ?? "",
  success: styles.success ?? "",
};

export function Button({ variant = "default", className, ...rest }: ButtonProps) {
  const classes = [styles.btn, variantClass[variant], className]
    .filter(Boolean)
    .join(" ");
  return <button type="button" {...rest} className={classes} />;
}

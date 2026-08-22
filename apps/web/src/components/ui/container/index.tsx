import type { ReactNode } from "react";

import { cn } from "@/utils";

/** The one page gutter. Every full-width band puts its content inside one. */
export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-[1200px] px-6", className)}>{children}</div>;
}

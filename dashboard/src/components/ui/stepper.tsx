"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StepperStep {
  id: number;
  label: string;
}

interface StepperProps {
  steps: StepperStep[];
  current: number;
  completed: Set<number>;
  onSelect?: (step: number) => void;
}

export function Stepper({ steps, current, completed, onSelect }: StepperProps) {
  return (
    <ol className="flex w-full items-center gap-2 overflow-x-auto">
      {steps.map((s, idx) => {
        const isCurrent = s.id === current;
        const isDone = completed.has(s.id);
        // Allow click-back to any earlier step + click to any completed step.
        const reachable = isDone || isCurrent || s.id < current;
        return (
          <li key={s.id} className="flex flex-1 items-center gap-2 min-w-fit">
            <button
              type="button"
              disabled={!reachable || !onSelect}
              onClick={() => reachable && onSelect?.(s.id)}
              className={cn(
                "group inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                isCurrent && "bg-primary/10 text-primary font-medium",
                !isCurrent && isDone && "text-foreground hover:bg-muted cursor-pointer",
                !isCurrent && !isDone && "text-muted-foreground cursor-not-allowed",
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                  isCurrent && "border-primary bg-primary text-primary-foreground",
                  !isCurrent && isDone && "border-green-500 bg-green-500 text-white",
                  !isCurrent && !isDone && "border-border bg-muted text-muted-foreground",
                )}
              >
                {isDone && !isCurrent ? <Check className="h-3.5 w-3.5" /> : s.id}
              </span>
              <span className="whitespace-nowrap">{s.label}</span>
            </button>
            {idx < steps.length - 1 && (
              <div
                className={cn(
                  "h-px flex-1 min-w-4",
                  completed.has(s.id) ? "bg-green-500/50" : "bg-border",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

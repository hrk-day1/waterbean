import { type InputHTMLAttributes } from "react";
import { cn } from "@/shared/lib/utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Input({ label, className, id, ...props }: InputProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-zinc-700">
          {label}
        </label>
      )}
      <input
        id={id}
        className={cn(
          "rounded-md border border-border bg-white px-3 py-2 text-sm shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-accent focus:ring-1 focus:ring-accent",
          className,
        )}
        {...props}
      />
    </div>
  );
}

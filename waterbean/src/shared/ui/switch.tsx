import * as SwitchPrimitives from "@radix-ui/react-switch";
import { cn } from "@/shared/lib/utils";

interface SwitchProps {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function Switch({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  className,
}: SwitchProps) {
  const labelId = `${id}-label`;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-surface-alt/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 space-y-0.5">
        <label id={labelId} htmlFor={id} className="text-sm font-medium text-zinc-700">
          {label}
        </label>
        {description && <p className="text-xs text-zinc-500">{description}</p>}
      </div>
      <SwitchPrimitives.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-labelledby={labelId}
        className={cn(
          "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
          "data-[state=checked]:bg-accent data-[state=unchecked]:bg-zinc-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-white",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <SwitchPrimitives.Thumb
          className={cn(
            "pointer-events-none block size-5 rounded-full bg-white shadow-sm ring-0 transition-transform",
            "data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0.5",
          )}
        />
      </SwitchPrimitives.Root>
    </div>
  );
}

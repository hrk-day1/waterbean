import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/shared/lib/utils";

interface SliderProps {
  id?: string;
  label?: string;
  min: number;
  max: number;
  value: number;
  onValueChange: (value: number) => void;
  valueDescription?: string;
  className?: string;
}

export function Slider({
  id,
  label,
  min,
  max,
  value,
  onValueChange,
  valueDescription,
  className,
}: SliderProps) {
  const steps = Array.from({ length: max - min + 1 }, (_, i) => min + i);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-zinc-700">
          {label}
        </label>
      )}
      <SliderPrimitive.Root
        id={id}
        className="relative flex w-full touch-none select-none items-center py-1"
        value={[value]}
        onValueChange={(v) => onValueChange(v[0] ?? min)}
        min={min}
        max={max}
        step={1}
        aria-valuetext={valueDescription}
      >
        <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-zinc-200">
          <SliderPrimitive.Range className="absolute h-full rounded-full bg-accent" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          className={cn(
            "block size-4 shrink-0 rounded-full border border-border bg-white shadow-sm",
            "outline-none transition-colors focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        />
      </SliderPrimitive.Root>
      <div className="flex justify-between px-1.5" aria-hidden>
        {steps.map((step) => (
          <span
            key={step}
            className={cn(
              "size-1.5 shrink-0 rounded-full transition-colors",
              step === value ? "bg-accent" : "bg-zinc-300",
            )}
          />
        ))}
      </div>
      {valueDescription && <p className="text-xs text-zinc-500">{valueDescription}</p>}
    </div>
  );
}

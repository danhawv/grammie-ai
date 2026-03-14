import { Upload, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface MobileFABProps {
  onClick: () => void;
  icon?: "upload" | "plus";
  label?: string;
  className?: string;
}

export function MobileFAB({
  onClick,
  icon = "upload",
  label = "Upload recipe",
  className,
}: MobileFABProps) {
  const Icon = icon === "upload" ? Upload : Plus;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-testid="button-mobile-fab"
      style={{
        position: 'fixed',
        bottom: '1.5rem',
        left: '1.5rem',
        zIndex: 9999,
      }}
      className={cn(
        "rounded-full",
        "w-16 h-16 inline-flex items-center justify-center p-0",
        "glass-regular shadow-lg",
        "md:hidden", // Hide on desktop
        "transition-transform hover:scale-105 active:scale-95",
        "focus:outline-none focus:ring-2 focus:ring-primary",
        className
      )}
    >
      <Icon className="w-6 h-6" strokeWidth={2} />
    </button>
  );
}

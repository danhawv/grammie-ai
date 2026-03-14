import { cn } from "@/lib/utils";

interface GlassSurfaceProps {
  variant?: "regular" | "clear";
  dimming?: boolean;
  scrolled?: boolean;
  className?: string;
  children: React.ReactNode;
  as?: keyof JSX.IntrinsicElements;
}

export function GlassSurface({
  variant = "regular",
  dimming = false,
  scrolled = false,
  className,
  children,
  as: Component = "div",
}: GlassSurfaceProps) {
  return (
    <Component
      className={cn(
        "glass-transition",
        variant === "regular" && "glass-regular",
        variant === "clear" && "glass-clear",
        dimming && "glass-dimming",
        scrolled && "glass-scrolled",
        className
      )}
    >
      {children}
    </Component>
  );
}

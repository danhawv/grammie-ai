import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, Search, ChevronDown } from "lucide-react";

interface FontInfo {
  family: string;
  category: string;
  variants: string[];
}

interface GoogleFontsPickerProps {
  value: string;
  onChange: (family: string, source: "google" | "custom") => void;
  label?: string;
  customFonts?: { name: string }[];
}

const CATEGORIES = [
  { id: "all", label: "All" },
  { id: "serif", label: "Serif" },
  { id: "sans-serif", label: "Sans" },
  { id: "display", label: "Display" },
  { id: "handwriting", label: "Script" },
];

// Track which fonts have been loaded into the page
const loadedFonts = new Set<string>();

function loadGoogleFont(family: string) {
  if (loadedFonts.has(family)) return;
  loadedFonts.add(family);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;700&display=swap`;
  document.head.appendChild(link);
}

export function GoogleFontsPicker({ value, onChange, label, customFonts }: GoogleFontsPickerProps) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery<{ fonts: FontInfo[] }>({
    queryKey: ["/api/fonts/google"],
  });

  const fonts = data?.fonts || [];

  // Preload selected font (custom fonts are loaded via @font-face by the caller)
  useEffect(() => {
    if (value && !customFonts?.some(f => f.name === value)) loadGoogleFont(value);
  }, [value, customFonts]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = useMemo(() => {
    return fonts.filter(f => {
      if (category !== "all" && f.category !== category) return false;
      if (search && !f.family.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [fonts, category, search]);

  const filteredCustom = useMemo(() => {
    if (!customFonts?.length || (category !== "all" && category !== "custom")) return [];
    return customFonts.filter(f =>
      !search || f.name.toLowerCase().includes(search.toLowerCase())
    );
  }, [customFonts, category, search]);

  // Preload visible fonts
  useEffect(() => {
    if (isOpen) {
      filtered.slice(0, 15).forEach(f => loadGoogleFont(f.family));
    }
  }, [isOpen, filtered]);

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>
      )}

      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 border rounded-md bg-background text-sm hover:bg-accent/50 transition-colors"
      >
        <span style={{ fontFamily: `'${value}', sans-serif` }} className="truncate">
          {value || "Select font..."}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 top-full mt-1 w-full bg-popover border rounded-md shadow-lg">
          {/* Search */}
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search fonts..."
                className="pl-7 h-8 text-xs"
                autoFocus
              />
            </div>
          </div>

          {/* Category filter */}
          <div className="flex gap-1 p-2 border-b flex-wrap">
            {(customFonts?.length
              ? [...CATEGORIES, { id: "custom", label: "Uploaded" }]
              : CATEGORIES
            ).map(cat => (
              <Badge
                key={cat.id}
                variant={category === cat.id ? "default" : "outline"}
                className="cursor-pointer text-[10px] px-2 py-0"
                onClick={() => setCategory(cat.id)}
              >
                {cat.label}
              </Badge>
            ))}
          </div>

          {/* Font list */}
          <ScrollArea className="max-h-48">
            <div className="p-1">
              {filteredCustom.map(font => (
                <button
                  key={`custom-${font.name}`}
                  type="button"
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-accent transition-colors text-left"
                  onClick={() => {
                    onChange(font.name, "custom");
                    setIsOpen(false);
                    setSearch("");
                  }}
                >
                  <span className="w-4 shrink-0">
                    {value === font.name && <Check className="w-3.5 h-3.5 text-primary" />}
                  </span>
                  <span
                    style={{ fontFamily: `'${font.name}', sans-serif` }}
                    className="flex-1 truncate"
                  >
                    {font.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground capitalize shrink-0">
                    uploaded
                  </span>
                </button>
              ))}
              {filtered.map(font => (
                <button
                  key={font.family}
                  type="button"
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-accent transition-colors text-left"
                  onMouseEnter={() => loadGoogleFont(font.family)}
                  onClick={() => {
                    onChange(font.family, "google");
                    setIsOpen(false);
                    setSearch("");
                  }}
                >
                  <span className="w-4 shrink-0">
                    {value === font.family && <Check className="w-3.5 h-3.5 text-primary" />}
                  </span>
                  <span
                    style={{ fontFamily: `'${font.family}', sans-serif` }}
                    className="flex-1 truncate"
                  >
                    {font.family}
                  </span>
                  <span className="text-[10px] text-muted-foreground capitalize shrink-0">
                    {font.category}
                  </span>
                </button>
              ))}
              {filtered.length === 0 && filteredCustom.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-3">No fonts found</p>
              )}
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

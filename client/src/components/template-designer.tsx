import { useState, useCallback, useMemo, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  Type,
  Palette,
  Image,
  BookOpen,
  Save,
  Loader2,
  Upload,
  Trash2,
} from "lucide-react";
import { GoogleFontsPicker } from "./google-fonts-picker";

// ============================================================================
// Types
// ============================================================================

interface TemplateData {
  fonts: {
    heading: { family: string; weight?: string; source?: "google" | "custom" };
    body: { family: string; weight?: string; source?: "google" | "custom" };
  };
  colors: {
    titleColor: string;
    subtitleColor: string;
    textColor: string;
    accentColor: string;
    borderColor: string;
    bgColor: string;
    sectionBg: string;
  };
  cover?: {
    backgroundColor?: string;
    textColor?: string;
    titleFont?: string | null;
    coverImage?: string | null;
  };
  background?: {
    type: "solid" | "image";
    value: string;
    opacity: number;
  };
  decorative?: {
    imageRadius?: string;
    dividerStyle?: "solid" | "dashed" | "dotted" | "double" | "none";
    borderWidth?: string;
  };
  fontSizes?: {
    title?: string;
    subtitle?: string;
    sectionTitle?: string;
    recipeTitle?: string;
    body?: string;
  };
}

interface CustomFont {
  name: string;
  format: string;
  dataUrl: string;
}

interface TemplateDesignerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingTemplate?: {
    id: number;
    name: string;
    description?: string | null;
    templateData: TemplateData;
    backgroundImage?: string | null;
    customFonts?: CustomFont[] | null;
  } | null;
  onSaved?: (template: any) => void;
}

const MAX_CUSTOM_FONTS = 4;

// ============================================================================
// Built-in theme presets as starting points
// ============================================================================

const PRESETS: Record<string, { name: string; data: TemplateData }> = {
  classic: {
    name: "Classic",
    data: {
      fonts: {
        heading: { family: "Merriweather", source: "google" },
        body: { family: "Merriweather", source: "google" },
      },
      colors: {
        titleColor: "#2c1810",
        subtitleColor: "#5a3e28",
        textColor: "#333333",
        accentColor: "#8b6914",
        borderColor: "#d4c5a9",
        bgColor: "#ffffff",
        sectionBg: "#faf8f5",
      },
      cover: { backgroundColor: "#2c1810", textColor: "#f5e6d3" },
      decorative: { imageRadius: "4px", dividerStyle: "solid", borderWidth: "2px" },
    },
  },
  modern: {
    name: "Modern",
    data: {
      fonts: {
        heading: { family: "Inter", source: "google" },
        body: { family: "Inter", source: "google" },
      },
      colors: {
        titleColor: "#1a1a1a",
        subtitleColor: "#666666",
        textColor: "#2d2d2d",
        accentColor: "#e85d4a",
        borderColor: "#e5e5e5",
        bgColor: "#ffffff",
        sectionBg: "#f7f7f7",
      },
      cover: { backgroundColor: "#1a1a1a", textColor: "#ffffff" },
      decorative: { imageRadius: "8px", dividerStyle: "none", borderWidth: "1px" },
    },
  },
  rustic: {
    name: "Rustic",
    data: {
      fonts: {
        heading: { family: "Caveat", source: "google" },
        body: { family: "Lora", source: "google" },
      },
      colors: {
        titleColor: "#3e2723",
        subtitleColor: "#5d4037",
        textColor: "#4e342e",
        accentColor: "#8d6e63",
        borderColor: "#bcaaa4",
        bgColor: "#faf6f1",
        sectionBg: "#efebe9",
      },
      cover: { backgroundColor: "#3e2723", textColor: "#d7ccc8" },
      decorative: { imageRadius: "0px", dividerStyle: "dashed", borderWidth: "1px" },
    },
  },
  elegant: {
    name: "Elegant",
    data: {
      fonts: {
        heading: { family: "Playfair Display", source: "google" },
        body: { family: "Source Serif Pro", source: "google" },
      },
      colors: {
        titleColor: "#1b2838",
        subtitleColor: "#546e7a",
        textColor: "#37474f",
        accentColor: "#b8860b",
        borderColor: "#b0bec5",
        bgColor: "#ffffff",
        sectionBg: "#eceff1",
      },
      cover: { backgroundColor: "#1b2838", textColor: "#cfd8dc" },
      decorative: { imageRadius: "2px", dividerStyle: "double", borderWidth: "2px" },
    },
  },
};

// ============================================================================
// Component
// ============================================================================

export function TemplateDesigner({ open, onOpenChange, editingTemplate, onSaved }: TemplateDesignerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [templateData, setTemplateData] = useState<TemplateData>(PRESETS.classic.data);
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
  const [customFonts, setCustomFonts] = useState<CustomFont[]>([]);
  const [uploadingFont, setUploadingFont] = useState(false);

  // Initialize from editing template or preset
  useEffect(() => {
    if (editingTemplate) {
      setName(editingTemplate.name);
      setTemplateData(editingTemplate.templateData);
      setBackgroundImage(editingTemplate.backgroundImage || null);
      setCustomFonts(editingTemplate.customFonts || []);
    } else {
      setName("");
      setTemplateData(PRESETS.classic.data);
      setBackgroundImage(null);
      setCustomFonts([]);
    }
  }, [editingTemplate, open]);

  // Inject @font-face rules so uploaded fonts render in the designer preview
  useEffect(() => {
    const styleId = "template-designer-custom-fonts";
    const existing = document.getElementById(styleId);
    if (customFonts.length === 0) {
      existing?.remove();
      return;
    }
    const style = existing instanceof HTMLStyleElement
      ? existing
      : document.createElement("style");
    style.id = styleId;
    style.textContent = customFonts.map(f =>
      `@font-face { font-family: '${f.name}'; src: url('${f.dataUrl}') format('${f.format}'); font-weight: normal; font-style: normal; }`
    ).join("\n");
    if (!style.isConnected) document.head.appendChild(style);
  }, [customFonts]);

  // Updater helpers
  const updateColors = useCallback((key: string, value: string) => {
    setTemplateData(prev => ({
      ...prev,
      colors: { ...prev.colors, [key]: value },
    }));
  }, []);

  const updateFont = useCallback((target: "heading" | "body", family: string, source: "google" | "custom" = "google") => {
    setTemplateData(prev => ({
      ...prev,
      fonts: {
        ...prev.fonts,
        [target]: { ...prev.fonts[target], family, source },
      },
    }));
  }, []);

  const updateCover = useCallback((key: string, value: string | null) => {
    setTemplateData(prev => ({
      ...prev,
      cover: { ...prev.cover, [key]: value },
    }));
  }, []);

  const updateDecorative = useCallback((key: string, value: string) => {
    setTemplateData(prev => ({
      ...prev,
      decorative: { ...prev.decorative, [key]: value },
    }));
  }, []);

  const updateFontSize = useCallback((key: string, value: string) => {
    setTemplateData(prev => {
      const fontSizes = { ...prev.fontSizes };
      if (value === "auto") {
        delete (fontSizes as any)[key];
      } else {
        (fontSizes as any)[key] = value;
      }
      return { ...prev, fontSizes: Object.keys(fontSizes).length ? fontSizes : undefined };
    });
  }, []);

  const loadPreset = useCallback((presetId: string) => {
    const preset = PRESETS[presetId];
    if (preset) setTemplateData(preset.data);
  }, []);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: any = {
        name: name.trim() || "Untitled Template",
        templateData,
        backgroundImage,
        // POST rejects null (schema is optional, not nullable); PATCH uses null to clear
        customFonts: customFonts.length > 0 ? customFonts : (editingTemplate ? null : undefined),
      };

      if (editingTemplate) {
        const res = await apiRequest("PATCH", `/api/templates/${editingTemplate.id}`, body);
        return await res.json();
      } else {
        const res = await apiRequest("POST", "/api/templates", body);
        return await res.json();
      }
    },
    onSuccess: (data) => {
      toast({ title: editingTemplate ? "Template updated" : "Template saved!" });
      queryClient.invalidateQueries({ queryKey: ["/api/templates"] });
      onSaved?.(data);
      onOpenChange(false);
    },
    onError: () => {
      toast({ title: "Failed to save template", variant: "destructive" });
    },
  });

  // Background upload
  const handleBackgroundUpload = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append("image", file);
    try {
      const res = await fetch("/api/templates/upload-background", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const data = await res.json();
      if (data.dataUrl) {
        setBackgroundImage(data.dataUrl);
        setTemplateData(prev => ({
          ...prev,
          background: { type: "image" as const, value: "uploaded", opacity: prev.background?.opacity ?? 0.15 },
        }));
      }
    } catch {
      toast({ title: "Failed to upload background", variant: "destructive" });
    }
  }, [toast]);

  // Upload cover image (reuses the same background upload endpoint)
  const handleCoverImageUpload = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append("image", file);
    try {
      const res = await fetch("/api/templates/upload-background", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const data = await res.json();
      if (data.dataUrl) {
        updateCover("coverImage", data.dataUrl);
      }
    } catch {
      toast({ title: "Failed to upload cover image", variant: "destructive" });
    }
  }, [toast, updateCover]);

  // Custom font upload
  const handleFontUpload = useCallback(async (file: File) => {
    if (customFonts.length >= MAX_CUSTOM_FONTS) {
      toast({ title: `At most ${MAX_CUSTOM_FONTS} custom fonts per template`, variant: "destructive" });
      return;
    }
    const formData = new FormData();
    formData.append("font", file);
    setUploadingFont(true);
    try {
      const res = await fetch("/api/templates/upload-font", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok || !data.dataUrl) {
        toast({ title: data.error || "Failed to upload font", variant: "destructive" });
        return;
      }
      setCustomFonts(prev => [
        ...prev.filter(f => f.name !== data.name),
        { name: data.name, format: data.format, dataUrl: data.dataUrl },
      ]);
      toast({ title: `Font "${data.name}" uploaded` });
    } catch {
      toast({ title: "Failed to upload font", variant: "destructive" });
    } finally {
      setUploadingFont(false);
    }
  }, [customFonts.length, toast]);

  const removeCustomFont = useCallback((fontName: string) => {
    setCustomFonts(prev => prev.filter(f => f.name !== fontName));
    // Fall back to a default font wherever the removed font was in use
    setTemplateData(prev => {
      const fallback = (slot: TemplateData["fonts"]["heading"]) =>
        slot.source === "custom" && slot.family === fontName
          ? { ...slot, family: "Merriweather", source: "google" as const }
          : slot;
      return {
        ...prev,
        fonts: {
          heading: fallback(prev.fonts.heading),
          body: fallback(prev.fonts.body),
        },
      };
    });
  }, []);

  // Color input helper
  const ColorInput = useMemo(() => {
    return function ColorField({ label, colorKey, value }: { label: string; colorKey: string; value: string }) {
      return (
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={value}
            onChange={e => updateColors(colorKey, e.target.value)}
            className="w-7 h-7 rounded border cursor-pointer shrink-0"
          />
          <div className="flex-1 min-w-0">
            <span className="text-xs">{label}</span>
          </div>
          <Input
            value={value}
            onChange={e => updateColors(colorKey, e.target.value)}
            className="w-20 h-7 text-xs font-mono"
          />
        </div>
      );
    };
  }, [updateColors]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 py-3 border-b shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <Palette className="w-5 h-5 text-primary" />
              {editingTemplate ? "Edit Template" : "Design Custom Template"}
            </DialogTitle>
            <div className="flex items-center gap-2">
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Template name..."
                className="w-48 h-8 text-sm"
              />
              <Button
                size="sm"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="gap-1.5"
              >
                {saveMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                Save
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-1 min-h-0">
          {/* Live Preview */}
          <div className="flex-1 p-4 bg-muted/30 overflow-auto">
            <TemplatePreview
              templateData={templateData}
              backgroundImage={backgroundImage}
            />
          </div>

          {/* Controls Panel */}
          <div className="w-80 border-l flex flex-col min-h-0">
            {/* Start from preset */}
            <div className="px-3 py-2 border-b">
              <Label className="text-xs text-muted-foreground">Start from</Label>
              <div className="flex gap-1 mt-1">
                {Object.entries(PRESETS).map(([id, preset]) => (
                  <Badge
                    key={id}
                    variant="outline"
                    className="cursor-pointer text-[10px] hover:bg-accent"
                    onClick={() => loadPreset(id)}
                  >
                    {preset.name}
                  </Badge>
                ))}
              </div>
            </div>

            <Tabs defaultValue="typography" className="flex-1 flex flex-col min-h-0">
              <TabsList className="w-full rounded-none border-b h-9 shrink-0">
                <TabsTrigger value="typography" className="text-xs gap-1 flex-1">
                  <Type className="w-3 h-3" /> Fonts
                </TabsTrigger>
                <TabsTrigger value="colors" className="text-xs gap-1 flex-1">
                  <Palette className="w-3 h-3" /> Colors
                </TabsTrigger>
                <TabsTrigger value="background" className="text-xs gap-1 flex-1">
                  <Image className="w-3 h-3" /> BG
                </TabsTrigger>
                <TabsTrigger value="cover" className="text-xs gap-1 flex-1">
                  <BookOpen className="w-3 h-3" /> Cover
                </TabsTrigger>
              </TabsList>

              <ScrollArea className="flex-1">
                {/* Typography Tab */}
                <TabsContent value="typography" className="p-3 space-y-4 mt-0">
                  <div>
                    <GoogleFontsPicker
                      label="Heading Font"
                      value={templateData.fonts.heading.family}
                      customFonts={customFonts}
                      onChange={(f, source) => updateFont("heading", f, source)}
                    />
                  </div>
                  <div>
                    <GoogleFontsPicker
                      label="Body Font"
                      value={templateData.fonts.body.family}
                      customFonts={customFonts}
                      onChange={(f, source) => updateFont("body", f, source)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Text Sizes</Label>
                    <div className="space-y-2 mt-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs w-20">Recipe title</span>
                        <Select
                          value={templateData.fontSizes?.recipeTitle || "auto"}
                          onValueChange={v => updateFontSize("recipeTitle", v)}
                        >
                          <SelectTrigger className="h-7 text-xs flex-1" data-testid="font-size-recipe-title">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">Auto</SelectItem>
                            <SelectItem value="16px">Compact (16px)</SelectItem>
                            <SelectItem value="20px">Standard (20px)</SelectItem>
                            <SelectItem value="24px">Large (24px)</SelectItem>
                            <SelectItem value="28px">Extra large (28px)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs w-20">Body text</span>
                        <Select
                          value={templateData.fontSizes?.body || "auto"}
                          onValueChange={v => updateFontSize("body", v)}
                        >
                          <SelectTrigger className="h-7 text-xs flex-1" data-testid="font-size-body">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">Auto</SelectItem>
                            <SelectItem value="10px">Small (10px)</SelectItem>
                            <SelectItem value="11.5px">Standard (11.5px)</SelectItem>
                            <SelectItem value="13px">Large (13px)</SelectItem>
                            <SelectItem value="14px">Extra large (14px)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Custom Fonts</Label>
                    <div className="space-y-1.5 mt-1">
                      {customFonts.map(f => (
                        <div key={f.name} className="flex items-center gap-2 px-2 py-1.5 border rounded-md" data-testid={`custom-font-${f.name}`}>
                          <span className="flex-1 text-sm truncate" style={{ fontFamily: `'${f.name}', sans-serif` }}>
                            {f.name}
                          </span>
                          <span className="text-[10px] text-muted-foreground uppercase shrink-0">{f.format}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0"
                            onClick={() => removeCustomFont(f.name)}
                            title="Remove font"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      ))}
                      {customFonts.length < MAX_CUSTOM_FONTS && (
                        <label className="flex flex-col items-center justify-center gap-1 py-3 border-2 border-dashed rounded-md cursor-pointer hover:bg-accent/50 transition-colors">
                          {uploadingFont ? (
                            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                          ) : (
                            <Upload className="w-4 h-4 text-muted-foreground" />
                          )}
                          <span className="text-xs text-muted-foreground">Upload custom font</span>
                          <span className="text-[10px] text-muted-foreground/70">TTF, OTF, WOFF, WOFF2 · max 1MB</span>
                          <input
                            type="file"
                            className="hidden"
                            accept=".ttf,.otf,.woff,.woff2"
                            disabled={uploadingFont}
                            onChange={e => {
                              const file = e.target.files?.[0];
                              if (file) handleFontUpload(file);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      )}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Decorative</Label>
                    <div className="space-y-2 mt-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs w-20">Image radius</span>
                        <Select
                          value={templateData.decorative?.imageRadius || "4px"}
                          onValueChange={v => updateDecorative("imageRadius", v)}
                        >
                          <SelectTrigger className="h-7 text-xs flex-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="0px">Sharp (0px)</SelectItem>
                            <SelectItem value="2px">Subtle (2px)</SelectItem>
                            <SelectItem value="4px">Soft (4px)</SelectItem>
                            <SelectItem value="8px">Round (8px)</SelectItem>
                            <SelectItem value="16px">Very Round (16px)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs w-20">Divider</span>
                        <Select
                          value={templateData.decorative?.dividerStyle || "solid"}
                          onValueChange={v => updateDecorative("dividerStyle", v)}
                        >
                          <SelectTrigger className="h-7 text-xs flex-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="solid">Solid</SelectItem>
                            <SelectItem value="dashed">Dashed</SelectItem>
                            <SelectItem value="dotted">Dotted</SelectItem>
                            <SelectItem value="double">Double</SelectItem>
                            <SelectItem value="none">None</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* Colors Tab */}
                <TabsContent value="colors" className="p-3 space-y-2 mt-0">
                  <ColorInput label="Title" colorKey="titleColor" value={templateData.colors.titleColor} />
                  <ColorInput label="Subtitle" colorKey="subtitleColor" value={templateData.colors.subtitleColor} />
                  <ColorInput label="Body text" colorKey="textColor" value={templateData.colors.textColor} />
                  <ColorInput label="Accent" colorKey="accentColor" value={templateData.colors.accentColor} />
                  <ColorInput label="Borders" colorKey="borderColor" value={templateData.colors.borderColor} />
                  <ColorInput label="Page bg" colorKey="bgColor" value={templateData.colors.bgColor} />
                  <ColorInput label="Section bg" colorKey="sectionBg" value={templateData.colors.sectionBg} />
                </TabsContent>

                {/* Background Tab */}
                <TabsContent value="background" className="p-3 space-y-3 mt-0">
                  <div>
                    <Label className="text-xs text-muted-foreground">Background Type</Label>
                    <Select
                      value={templateData.background?.type || "solid"}
                      onValueChange={v => setTemplateData(prev => ({
                        ...prev,
                        background: { ...prev.background!, type: v as any, value: prev.background?.value || prev.colors.bgColor, opacity: prev.background?.opacity ?? 0.15 },
                      }))}
                    >
                      <SelectTrigger className="h-8 text-xs mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="solid">Solid Color</SelectItem>
                        <SelectItem value="image">Texture / Image</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {(templateData.background?.type === "image") && (
                    <>
                      <div>
                        <Label className="text-xs text-muted-foreground">Upload Texture</Label>
                        <div className="mt-1">
                          {backgroundImage ? (
                            <div className="relative">
                              <img
                                src={backgroundImage}
                                alt="Background"
                                className="w-full h-24 object-cover rounded border"
                              />
                              <Button
                                variant="destructive"
                                size="icon"
                                className="absolute top-1 right-1 h-6 w-6"
                                onClick={() => {
                                  setBackgroundImage(null);
                                  setTemplateData(prev => ({
                                    ...prev,
                                    background: { type: "solid", value: prev.colors.bgColor, opacity: 0.15 },
                                  }));
                                }}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          ) : (
                            <label className="flex flex-col items-center justify-center gap-1 h-20 border-2 border-dashed rounded-md cursor-pointer hover:bg-accent/50 transition-colors">
                              <div className="flex items-center gap-2">
                                <Upload className="w-4 h-4 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground">Upload image</span>
                              </div>
                              <span className="text-[10px] text-muted-foreground/70">PNG, JPEG, WebP, SVG · max 2MB</span>
                              <input
                                type="file"
                                className="hidden"
                                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                                onChange={e => {
                                  const file = e.target.files?.[0];
                                  if (file) handleBackgroundUpload(file);
                                }}
                              />
                            </label>
                          )}
                        </div>
                      </div>

                      <div>
                        <Label className="text-xs text-muted-foreground">
                          Opacity: {Math.round((templateData.background?.opacity ?? 0.15) * 100)}%
                        </Label>
                        <Slider
                          value={[(templateData.background?.opacity ?? 0.15) * 100]}
                          onValueChange={([v]) => setTemplateData(prev => ({
                            ...prev,
                            background: { ...prev.background!, opacity: v / 100 },
                          }))}
                          min={5}
                          max={50}
                          step={5}
                          className="mt-1"
                        />
                      </div>
                    </>
                  )}
                </TabsContent>

                {/* Cover Tab */}
                <TabsContent value="cover" className="p-3 space-y-3 mt-0">
                  <div>
                    <Label className="text-xs text-muted-foreground">Cover Background</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="color"
                        value={templateData.cover?.backgroundColor || "#2c1810"}
                        onChange={e => updateCover("backgroundColor", e.target.value)}
                        className="w-8 h-8 rounded border cursor-pointer"
                      />
                      <Input
                        value={templateData.cover?.backgroundColor || "#2c1810"}
                        onChange={e => updateCover("backgroundColor", e.target.value)}
                        className="h-8 text-xs font-mono flex-1"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Cover Text Color</Label>
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="color"
                        value={templateData.cover?.textColor || "#ffffff"}
                        onChange={e => updateCover("textColor", e.target.value)}
                        className="w-8 h-8 rounded border cursor-pointer"
                      />
                      <Input
                        value={templateData.cover?.textColor || "#ffffff"}
                        onChange={e => updateCover("textColor", e.target.value)}
                        className="h-8 text-xs font-mono flex-1"
                      />
                    </div>
                  </div>

                  {/* Cover Image Upload */}
                  <div>
                    <Label className="text-xs text-muted-foreground">Cover Image</Label>
                    {templateData.cover?.coverImage ? (
                      <div className="mt-1 space-y-2">
                        <div className="relative rounded-md overflow-hidden border" style={{ height: 120 }}>
                          <img
                            src={templateData.cover.coverImage}
                            alt="Cover"
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => updateCover("coverImage", null)}
                            >
                              <Trash2 className="w-3 h-3 mr-1" /> Remove
                            </Button>
                          </div>
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          Image will overlay on the cover background
                        </p>
                      </div>
                    ) : (
                      <label className="mt-1 flex flex-col items-center gap-1.5 p-4 border-2 border-dashed rounded-md cursor-pointer hover:border-primary/50 transition-colors">
                        <Upload className="w-5 h-5 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          Upload cover image (PNG, JPG, WebP)
                        </span>
                        <span className="text-[10px] text-muted-foreground/70">Max 2MB</span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          onChange={e => {
                            const file = e.target.files?.[0];
                            if (file) handleCoverImageUpload(file);
                          }}
                        />
                      </label>
                    )}
                  </div>
                </TabsContent>
              </ScrollArea>
            </Tabs>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Live Preview Component
// ============================================================================

function TemplatePreview({ templateData, backgroundImage }: { templateData: TemplateData; backgroundImage: string | null }) {
  const { fonts, colors, decorative, background } = templateData;
  const headingFont = `'${fonts.heading.family}', serif`;
  const bodyFont = `'${fonts.body.family}', sans-serif`;

  // Load Google fonts for preview (custom fonts render via injected @font-face)
  useEffect(() => {
    [fonts.heading, fonts.body].forEach(({ family, source }) => {
      if (source === "custom") return;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;700&display=swap`;
      if (!document.querySelector(`link[href="${link.href}"]`)) {
        document.head.appendChild(link);
      }
    });
  }, [fonts.heading.family, fonts.heading.source, fonts.body.family, fonts.body.source]);

  const hasBgImage = background?.type === "image" && backgroundImage;

  return (
    <div className="space-y-4">
      {/* Cover Preview */}
      <div className="text-center mb-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Cover Preview</span>
      </div>
      <div
        className="mx-auto rounded-lg shadow-lg overflow-hidden relative"
        style={{
          width: 240,
          height: 320,
          backgroundColor: templateData.cover?.backgroundColor || colors.titleColor,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          padding: 24,
        }}
      >
        {/* Cover image overlay */}
        {templateData.cover?.coverImage && (
          <>
            <img
              src={templateData.cover.coverImage}
              alt=""
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                opacity: 0.3,
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 50%)",
              }}
            />
          </>
        )}
        <div
          style={{
            fontFamily: headingFont,
            fontSize: 22,
            fontWeight: 700,
            color: templateData.cover?.textColor || "#ffffff",
            textAlign: "center",
            lineHeight: 1.2,
            position: "relative",
            zIndex: 1,
          }}
        >
          My Cookbook
        </div>
        <div
          style={{
            width: 40,
            height: 2,
            backgroundColor: colors.accentColor,
            margin: "12px auto",
            borderRadius: 1,
            position: "relative",
            zIndex: 1,
          }}
        />
        <div
          style={{
            fontFamily: bodyFont,
            fontSize: 11,
            color: templateData.cover?.textColor || "#ffffff",
            opacity: 0.7,
            textAlign: "center",
            position: "relative",
            zIndex: 1,
          }}
        >
          A collection of family recipes
        </div>
      </div>

      {/* Recipe Page Preview */}
      <div className="text-center mt-6 mb-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Recipe Page Preview</span>
      </div>
      <div
        className="mx-auto rounded-lg shadow-lg overflow-hidden relative"
        style={{
          width: 320,
          minHeight: 420,
          backgroundColor: colors.bgColor,
          padding: 24,
        }}
      >
        {/* Background image overlay */}
        {hasBgImage && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: `url('${backgroundImage}')`,
              backgroundSize: "cover",
              opacity: background?.opacity ?? 0.15,
              pointerEvents: "none",
            }}
          />
        )}

        {/* Content */}
        <div style={{ position: "relative", zIndex: 1 }}>
          {/* Recipe title */}
          <h2
            style={{
              fontFamily: headingFont,
              fontSize: 20,
              fontWeight: 700,
              color: colors.titleColor,
              marginBottom: 4,
              borderBottom: decorative?.dividerStyle !== "none"
                ? `${decorative?.borderWidth || "2px"} ${decorative?.dividerStyle || "solid"} ${colors.accentColor}`
                : "none",
              paddingBottom: 6,
            }}
          >
            Grandmother's Apple Pie
          </h2>

          {/* Meta */}
          <div
            style={{
              fontFamily: bodyFont,
              fontSize: 10,
              color: colors.subtitleColor,
              marginBottom: 12,
            }}
          >
            Prep: 30 min · Cook: 45 min · Serves 8
          </div>

          {/* Image placeholder */}
          <div
            style={{
              width: "100%",
              height: 100,
              backgroundColor: colors.sectionBg,
              borderRadius: decorative?.imageRadius || "4px",
              marginBottom: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ fontSize: 10, color: colors.subtitleColor }}>📷 Recipe Photo</span>
          </div>

          {/* Two columns */}
          <div style={{ display: "flex", gap: 16 }}>
            {/* Ingredients */}
            <div style={{ flex: "0 0 40%" }}>
              <h3
                style={{
                  fontFamily: headingFont,
                  fontSize: 11,
                  fontWeight: 700,
                  color: colors.accentColor,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  marginBottom: 6,
                }}
              >
                Ingredients
              </h3>
              {["6 Granny Smith apples", "¾ cup sugar", "2 tbsp flour", "1 tsp cinnamon", "¼ tsp nutmeg", "1 tbsp butter"].map((ing, i) => (
                <div
                  key={i}
                  style={{
                    fontFamily: bodyFont,
                    fontSize: 9,
                    color: colors.textColor,
                    paddingLeft: 8,
                    marginBottom: 3,
                    borderLeft: `2px solid ${colors.borderColor}`,
                  }}
                >
                  {ing}
                </div>
              ))}
            </div>

            {/* Instructions */}
            <div style={{ flex: 1 }}>
              <h3
                style={{
                  fontFamily: headingFont,
                  fontSize: 11,
                  fontWeight: 700,
                  color: colors.accentColor,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  marginBottom: 6,
                }}
              >
                Instructions
              </h3>
              {[
                "Peel and slice the apples thinly.",
                "Mix sugar, flour, cinnamon, and nutmeg.",
                "Toss apples with the sugar mixture.",
                "Pour into prepared pie crust.",
              ].map((step, i) => (
                <div
                  key={i}
                  style={{
                    fontFamily: bodyFont,
                    fontSize: 9,
                    color: colors.textColor,
                    marginBottom: 5,
                    display: "flex",
                    gap: 6,
                  }}
                >
                  <span style={{ color: colors.accentColor, fontWeight: 700, fontSize: 10 }}>{i + 1}</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

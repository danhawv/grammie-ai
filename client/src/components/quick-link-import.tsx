import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Instagram, Link2, Upload, Loader2, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CookbookSelect } from "@/components/cookbook-select";
import { useAuth } from "@/hooks/useAuth";
import { useUploadProgress } from "@/contexts/UploadProgressContext";

type Platform = "instagram" | "tiktok" | "web" | null;

function detectPlatform(url: string): Platform {
  if (!url) return null;
  
  const instagramPatterns = [
    /instagram\.com\/(p|reel|reels)\//i,
    /instagr\.am\//i,
  ];
  
  const tiktokPatterns = [
    /tiktok\.com\/@[\w.-]+\/video\//i,
    /tiktok\.com\/t\//i,
    /vm\.tiktok\.com\//i,
  ];
  
  for (const pattern of instagramPatterns) {
    if (pattern.test(url)) return "instagram";
  }
  
  for (const pattern of tiktokPatterns) {
    if (pattern.test(url)) return "tiktok";
  }
  
  if (url.startsWith("http://") || url.startsWith("https://") || url.includes(".")) {
    return "web";
  }
  
  return null;
}

interface QuickLinkImportProps {
  onSuccess?: () => void;
}

export function QuickLinkImport({ onSuccess }: QuickLinkImportProps) {
  const [linkUrl, setLinkUrl] = useState("");
  const [platform, setPlatform] = useState<Platform>(null);
  const [selectedCookbookId, setSelectedCookbookId] = useState<string | undefined>();
  const [showCookbookPicker, setShowCookbookPicker] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const { addRecipe } = useUploadProgress();

  useEffect(() => {
    const detected = detectPlatform(linkUrl);
    setPlatform(detected);
  }, [linkUrl]);

  const importMutation = useMutation({
    mutationFn: async (url: string) => {
      // Use the social import endpoint for Instagram/TikTok (uses Apify scraper)
      // Use extract-url for regular web pages
      const detectedPlatform = detectPlatform(url);
      const endpoint = (detectedPlatform === "instagram" || detectedPlatform === "tiktok")
        ? "/api/recipes/import-social"
        : "/api/recipes/extract-url";
      
      const response = await apiRequest("POST", endpoint, { url });
      return response.json() as Promise<{ recipeId: string }>;
    },
    onSuccess: async (data) => {
      addRecipe(data.recipeId, "Your Recipe");
      
      if (selectedCookbookId) {
        try {
          await apiRequest("POST", `/api/cookbooks/${selectedCookbookId}/recipes`, {
            recipeId: data.recipeId,
          });
        } catch (error) {
          console.error("Failed to add to cookbook:", error);
        }
      }
      
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cookbooks"] });
      
      toast({
        title: "Recipe importing",
        description: "Your recipe is being processed. It will appear shortly.",
      });
      
      setLinkUrl("");
      setPlatform(null);
      setShowCookbookPicker(false);
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({
        title: "Import failed",
        description: error.message || "Failed to import recipe from link",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    if (!linkUrl.trim()) {
      toast({
        title: "URL required",
        description: "Please paste a recipe link to import",
        variant: "destructive",
      });
      return;
    }

    let finalUrl = linkUrl.trim();
    if (!finalUrl.startsWith("http://") && !finalUrl.startsWith("https://")) {
      finalUrl = "https://" + finalUrl;
    }

    try {
      new URL(finalUrl);
    } catch {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid URL",
        variant: "destructive",
      });
      return;
    }

    if (!user) {
      toast({
        title: "Sign in required",
        description: "Please sign in to import recipes",
      });
      return;
    }

    importMutation.mutate(finalUrl);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !importMutation.isPending) {
      handleSubmit();
    }
  };

  const PlatformIcon = () => {
    if (!platform) return <Link2 className="h-5 w-5 text-muted-foreground" />;
    
    switch (platform) {
      case "instagram":
        return (
          <div className="h-6 w-6 rounded-md bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 flex items-center justify-center">
            <Instagram className="h-4 w-4 text-white" />
          </div>
        );
      case "tiktok":
        return (
          <div className="h-6 w-6 rounded-md bg-black flex items-center justify-center">
            <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/>
            </svg>
          </div>
        );
      case "web":
        return <Globe className="h-5 w-5 text-primary" />;
      default:
        return <Link2 className="h-5 w-5 text-muted-foreground" />;
    }
  };

  return (
    <div className="w-full" data-testid="quick-link-import">
      <div className="glass-regular rounded-xl p-4 shadow-sm border border-white/10">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            {/* Show detected platform icon */}
            {platform && (
              <div className="flex-shrink-0">
                <PlatformIcon />
              </div>
            )}
            <div className="relative flex-1">
              <Input
                type="url"
                placeholder="Paste social link"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={handleKeyDown}
                className="bg-background/50 pr-16"
                data-testid="input-quick-link"
              />
              {/* Social icons inside the input on the right */}
              {!linkUrl && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none">
                  <div className="h-5 w-5 rounded bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 flex items-center justify-center">
                    <Instagram className="h-3 w-3 text-white" />
                  </div>
                  <div className="h-5 w-5 rounded bg-black flex items-center justify-center">
                    <svg className="h-3 w-3 text-white" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/>
                    </svg>
                  </div>
                </div>
              )}
            </div>
            <Button
              onClick={handleSubmit}
              disabled={!linkUrl.trim() || importMutation.isPending}
              size="icon"
              data-testid="button-quick-import"
            >
              {importMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
            </Button>
          </div>
          
          {user && linkUrl.trim() && (
            <div className="flex items-center gap-2">
              {showCookbookPicker ? (
                <div className="flex-1">
                  <CookbookSelect
                    value={selectedCookbookId}
                    onValueChange={setSelectedCookbookId}
                    placeholder="Choose a cookbook (optional)"
                    allowNone={true}
                    testId="select-quick-cookbook"
                  />
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCookbookPicker(true)}
                  className="text-muted-foreground text-xs"
                  data-testid="button-add-to-cookbook"
                >
                  + Add to cookbook
                </Button>
              )}
            </div>
          )}

          {platform && (
            <p className="text-xs text-muted-foreground">
              {platform === "instagram" && "Instagram recipe detected - will extract from post caption"}
              {platform === "tiktok" && "TikTok recipe detected - will extract from video"}
              {platform === "web" && "Web recipe detected - will extract from page"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

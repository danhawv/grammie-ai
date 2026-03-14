import { useState, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { Instagram, Video, X, ArrowRight, Loader2, Clipboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type Platform = "instagram" | "tiktok" | null;
type CheckResult = "found" | "not_found" | "denied" | "error";

function detectPlatform(text: string): Platform {
  if (!text) return null;
  
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
    if (pattern.test(text)) return "instagram";
  }
  
  for (const pattern of tiktokPatterns) {
    if (pattern.test(text)) return "tiktok";
  }
  
  return null;
}

function extractUrl(text: string): string | null {
  const urlMatch = text.match(/https?:\/\/[^\s]+/i);
  return urlMatch ? urlMatch[0] : null;
}

export function ClipboardRecipeDetector() {
  const [detectedLink, setDetectedLink] = useState<string | null>(null);
  const [platform, setPlatform] = useState<Platform>(null);
  const [dismissed, setDismissed] = useState(false);
  const [lastCheckedText, setLastCheckedText] = useState<string>("");
  const [showPrompt, setShowPrompt] = useState(false);
  const [checking, setChecking] = useState(false);
  const { toast } = useToast();

  const importMutation = useMutation({
    mutationFn: async (url: string) => {
      const response = await apiRequest("POST", "/api/recipes/extract-url", { url });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recipes"] });
      toast({
        title: "Recipe importing",
        description: "Your recipe is being processed. It will appear shortly.",
      });
      setDetectedLink(null);
      setPlatform(null);
      setDismissed(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Import failed",
        description: error.message || "Failed to import recipe from link",
        variant: "destructive",
      });
    },
  });

  const checkClipboard = useCallback(async (): Promise<CheckResult> => {
    if (dismissed) return "not_found";
    
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        return "error";
      }
      
      // Check permissions if the API is available (not on Safari/iOS)
      if (navigator.permissions?.query) {
        try {
          const permissionStatus = await navigator.permissions.query({
            name: "clipboard-read" as PermissionName,
          });
          
          if (permissionStatus.state === "denied") {
            return "denied";
          }
        } catch {
          // Permission query not supported for clipboard, continue anyway
        }
      }
      
      const text = await navigator.clipboard.readText();
      
      if (text === lastCheckedText) {
        return "not_found";
      }
      
      setLastCheckedText(text);
      
      const detectedPlatform = detectPlatform(text);
      if (detectedPlatform) {
        const url = extractUrl(text);
        if (url) {
          setDetectedLink(url);
          setPlatform(detectedPlatform);
          setDismissed(false);
          return "found";
        }
      } else {
        setDetectedLink(null);
        setPlatform(null);
      }
      return "not_found";
    } catch (e) {
      // Check if it's a permission denial
      if (e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError")) {
        return "denied";
      }
      return "error";
    }
  }, [dismissed, lastCheckedText]);

  useEffect(() => {
    // Only show on mobile devices (clipboard requires user gesture on all platforms)
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    if (!isMobile) {
      return;
    }
    
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        setDismissed(false);
        setShowPrompt(true);
      }
    };
    
    setShowPrompt(true);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const handleImport = () => {
    if (detectedLink) {
      importMutation.mutate(detectedLink);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    setDetectedLink(null);
    setPlatform(null);
    setShowPrompt(false);
  };

  const handleCheckClipboard = async () => {
    setChecking(true);
    const result = await checkClipboard();
    setChecking(false);
    
    switch (result) {
      case "found":
        // Link found, banner will show automatically
        setShowPrompt(false);
        break;
      case "denied":
        toast({
          title: "Clipboard access blocked",
          description: "Please allow clipboard access in your browser settings, or use the upload button to paste links manually",
          variant: "destructive",
        });
        // Keep prompt visible so user can retry
        break;
      case "error":
        toast({
          title: "Couldn't read clipboard",
          description: "Use the upload button to add recipes by pasting links",
        });
        setShowPrompt(false);
        break;
      case "not_found":
      default:
        toast({
          title: "No recipe link found",
          description: "Copy an Instagram or TikTok link and try again",
        });
        setShowPrompt(false);
        break;
    }
  };

  // Show prompt for manual clipboard check on mobile
  if (showPrompt && !detectedLink && !dismissed) {
    return (
      <div 
        className="fixed bottom-20 left-4 right-4 z-50 animate-in slide-in-from-bottom-4 duration-300"
        data-testid="clipboard-recipe-prompt"
      >
        <div className="glass-regular rounded-xl p-4 shadow-lg border border-white/20">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Clipboard className="w-5 h-5 text-primary" />
            </div>
            
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">
                Recipe link copied?
              </p>
              <p className="text-xs text-muted-foreground">
                Tap to check for Instagram/TikTok links
              </p>
            </div>
            
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleDismiss}
                className="h-8 w-8"
                data-testid="button-dismiss-clipboard-prompt"
              >
                <X className="w-4 h-4" />
              </Button>
              
              <Button
                onClick={handleCheckClipboard}
                disabled={checking}
                className="h-9 px-4"
                data-testid="button-check-clipboard"
              >
                {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : "Check"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!detectedLink || !platform || dismissed) {
    return null;
  }

  return (
    <div 
      className="fixed bottom-20 left-4 right-4 z-50 animate-in slide-in-from-bottom-4 duration-300"
      data-testid="clipboard-recipe-banner"
    >
      <div className="glass-regular rounded-xl p-4 shadow-lg border border-white/20">
        <div className="flex items-center gap-3">
          <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${
            platform === "instagram" 
              ? "bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400" 
              : "bg-black"
          }`}>
            {platform === "instagram" ? (
              <Instagram className="w-5 h-5 text-white" />
            ) : (
              <Video className="w-5 h-5 text-white" />
            )}
          </div>
          
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">
              {platform === "instagram" ? "Instagram" : "TikTok"} recipe detected
            </p>
            <p className="text-xs text-muted-foreground truncate">
              Tap to import this recipe
            </p>
          </div>
          
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDismiss}
              className="h-8 w-8"
              data-testid="button-dismiss-clipboard"
            >
              <X className="w-4 h-4" />
            </Button>
            
            <Button
              onClick={handleImport}
              disabled={importMutation.isPending}
              className="h-9 px-4"
              data-testid="button-import-clipboard"
            >
              {importMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  Import
                  <ArrowRight className="w-4 h-4 ml-1" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

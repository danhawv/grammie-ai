import { useState, useCallback, useEffect } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Upload, CheckCircle2, Link2, Sparkles, RotateCw, RotateCcw, Plus, X, FileText, Layers, Images, Globe } from "lucide-react";
import { SiInstagram, SiTiktok } from "react-icons/si";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { useUploadProgress } from "@/contexts/UploadProgressContext";
import { CookbookSelect } from "@/components/cookbook-select";
import grandmaImage from "@assets/image_1763329917086.png";

const urlSchema = z.object({
  url: z.string().url("Please enter a valid URL"),
});

interface UploadRecipeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: "image" | "link" | "text";
}

interface UploadItem {
  id: string;
  file: File;
  preview: string;
  rotation: number;
  isHeic: boolean;
}

export function UploadRecipeModal({
  open,
  onOpenChange,
  initialMode = "image",
}: UploadRecipeModalProps) {
  const [mode, setMode] = useState<"image" | "link" | "text">(initialMode);
  const [linkUrl, setLinkUrl] = useState("");
  const [detectedPlatform, setDetectedPlatform] = useState<"instagram" | "tiktok" | "web" | null>(null);
  const [imageMode, setImageMode] = useState<"single" | "batch">("single");
  const [recipeText, setRecipeText] = useState("");
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedFiles, setSelectedFiles] = useState<UploadItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [selectedCookbookId, setSelectedCookbookId] = useState<string | undefined>();
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { addRecipe } = useUploadProgress();

  // Check auth status
  const { data: authStatus } = useQuery<{ isAuthenticated: boolean; userId: string | null }>({
    queryKey: ["/api/auth/status"],
    enabled: open,
  });

  // When modal opens, check if user is authenticated
  useEffect(() => {
    if (open && authStatus && !authStatus.isAuthenticated) {
      setShowAuthPrompt(true);
    } else {
      setShowAuthPrompt(false);
    }
  }, [open, authStatus]);

  // Update mode when modal opens with different initialMode (e.g., quick paste)
  useEffect(() => {
    if (open) {
      setMode(initialMode);
    }
  }, [open, initialMode]);

  const urlForm = useForm<z.infer<typeof urlSchema>>({
    resolver: zodResolver(urlSchema),
    defaultValues: {
      url: "",
    },
  });

  // Helper: Shared success handler for both image and URL extractions
  // Note: Recipe should already be added to progress tracker before calling this
  const handleRecipeSuccess = async (recipeId: string, title: string = "Your Recipe") => {
    // Add to cookbook if one was selected
    if (selectedCookbookId) {
      try {
        await apiRequest("POST", `/api/cookbooks/${selectedCookbookId}/recipes`, {
          recipeId,
        });
      } catch (error) {
        console.error("Failed to add recipe to cookbook:", error);
        // Don't show error toast - recipe upload succeeded which is more important
      }
    }
    
    // Invalidate ALL recipe queries (base and scoped) using predicate
    await queryClient.invalidateQueries({ 
      predicate: (query) => {
        const key = query.queryKey[0];
        return key === '/api/recipes';
      }
    });
    
    // Show Grammie confirmation screen (step 2)
    setStep(2);
    
    // After 3 seconds, close modal and navigate to home
    setTimeout(() => {
      onOpenChange(false);
      navigate('/');
      resetModal();
    }, 3000);  // Show Grammie for 3 seconds before redirecting home
  };

  // Helper: Show brief "Recipe queued" confirmation
  const showQueuedConfirmation = () => {
    setStep(2);
  };

  // URL extraction mutation
  const urlMutation = useMutation({
    mutationFn: async (url: string) => {
      const response = await apiRequest("POST", "/api/recipes/extract-url", {
        url,
      });
      return response.json() as Promise<{ recipeId: string }>;
    },
    onSuccess: async (data) => {
      // IMMEDIATELY add to progress tracker with placeholder title
      // This ensures the banner appears right away
      addRecipe(data.recipeId, "Your Recipe");
      
      // Show success flow
      await handleRecipeSuccess(data.recipeId, "Your Recipe");
      
      // Try to fetch actual title in background and update (non-blocking)
      queryClient.fetchQuery({
        queryKey: ["/api/recipes", data.recipeId],
      }).then((recipe: any) => {
        // Title will be updated by the progress polling system
      }).catch(() => {
        // Silently fail - we already have placeholder
      });
    },
    onError: (error: Error) => {
      toast({
        title: "URL import failed",
        description: error.message || "Failed to extract recipe from URL. Please try again.",
        variant: "destructive",
      });
      setStep(1);
    },
  });

  // Text extraction mutation
  const textMutation = useMutation({
    mutationFn: async (text: string) => {
      const response = await apiRequest("POST", "/api/recipes/extract-text", {
        text,
      });
      return response.json() as Promise<{ recipeId: string }>;
    },
    onSuccess: async (data) => {
      addRecipe(data.recipeId, "Your Recipe");
      await handleRecipeSuccess(data.recipeId, "Your Recipe");
      
      queryClient.fetchQuery({
        queryKey: ["/api/recipes", data.recipeId],
      }).catch(() => {});
    },
    onError: (error: Error) => {
      toast({
        title: "Text import failed",
        description: error.message || "Failed to process recipe text. Please try again.",
        variant: "destructive",
      });
      setStep(1);
    },
  });

  // Social media import mutation (Instagram, TikTok)
  const socialMutation = useMutation({
    mutationFn: async (url: string) => {
      const response = await apiRequest("POST", "/api/recipes/import-social", {
        url,
      });
      return response.json() as Promise<{ recipeId: string; message: string; source: { type: string; creator?: string } }>;
    },
    onSuccess: async (data) => {
      const platformName = data.source?.type === "tiktok" ? "TikTok" : "Instagram";
      addRecipe(data.recipeId, `${platformName} Recipe`);
      await handleRecipeSuccess(data.recipeId, `${platformName} Recipe`);
      
      toast({
        title: "Recipe import started!",
        description: data.message,
      });
      
      queryClient.fetchQuery({
        queryKey: ["/api/recipes", data.recipeId],
      }).catch(() => {});
    },
    onError: (error: Error) => {
      toast({
        title: "Import failed",
        description: error.message || "Failed to import recipe. Please try again.",
        variant: "destructive",
      });
      setStep(1);
    },
  });

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(Array.from(e.target.files));
    }
  };

  const handleFiles = (files: File[]) => {
    // Different limits based on image mode
    const maxFiles = imageMode === "single" ? 5 : 10;
    const remainingSlots = maxFiles - selectedFiles.length;
    
    if (files.length > remainingSlots) {
      toast({
        title: "Too many files",
        description: imageMode === "single" 
          ? `You can upload up to 5 images for a single recipe. ${remainingSlots} slot${remainingSlots === 1 ? '' : 's'} remaining.`
          : `You can upload up to 10 recipes at once. ${remainingSlots} slot${remainingSlots === 1 ? '' : 's'} remaining.`,
        variant: "destructive",
      });
      files = files.slice(0, remainingSlots);
    }

    // Process each file
    files.forEach((file) => processFile(file));
  };

  const processFile = (file: File) => {
    console.log("processFile called with:", { 
      name: file.name, 
      type: file.type, 
      size: file.size 
    });

    // Check if it's a HEIC/HEIF file
    const isHeic = file.type === 'image/heic' || 
                   file.type === 'image/heif' ||
                   file.name.toLowerCase().endsWith('.heic') ||
                   file.name.toLowerCase().endsWith('.heif');

    // For non-HEIC files, validate that they're images
    if (!isHeic && !file.type.startsWith("image/")) {
      console.error("Invalid file type:", file.type);
      toast({
        title: "Invalid file type",
        description: `"${file.name}" is not an image file.`,
        variant: "destructive",
      });
      return;
    }

    const id = `${Date.now()}-${Math.random()}`;
    
    // HEIC files can't be previewed in the browser, show a placeholder
    if (isHeic) {
      console.log("HEIC file detected, using placeholder preview");
      const placeholderSvg = `<svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
        <rect width="400" height="300" fill="#f3f4f6"/>
        <text x="200" y="140" font-family="Arial" font-size="18" fill="#6b7280" text-anchor="middle">HEIC Image</text>
        <text x="200" y="170" font-family="Arial" font-size="12" fill="#9ca3af" text-anchor="middle">${file.name}</text>
      </svg>`;
      const preview = `data:image/svg+xml;base64,${btoa(placeholderSvg)}`;
      
      setSelectedFiles(prev => [...prev, { id, file, preview, rotation: 0, isHeic: true }]);
      return;
    }
    
    // For other image types, use FileReader to create preview
    const reader = new FileReader();
    
    reader.onerror = (error) => {
      console.error("FileReader error:", error);
      toast({
        title: "Error reading file",
        description: `Failed to load "${file.name}". Please try again.`,
        variant: "destructive",
      });
    };
    
    reader.onloadend = () => {
      const preview = reader.result as string;
      setSelectedFiles(prev => [...prev, { id, file, preview, rotation: 0, isHeic: false }]);
    };
    
    reader.readAsDataURL(file);
  };

  const handleUpload = async () => {
    console.log("handleUpload called, files:", selectedFiles.length);
    if (selectedFiles.length === 0) {
      console.error("No files selected!");
      return;
    }

    showQueuedConfirmation();
    setUploadingCount(selectedFiles.length);

    try {
      let sessionId: string | undefined;

      // Create upload session if multiple files
      if (selectedFiles.length > 1) {
        const sessionResponse = await apiRequest("POST", "/api/uploads/sessions", {
          totalFiles: selectedFiles.length,
        });
        const sessionData = await sessionResponse.json();
        sessionId = sessionData.id;
        console.log(`Created upload session ${sessionId} for ${selectedFiles.length} files`);
      }

      // Upload each file sequentially
      for (let i = 0; i < selectedFiles.length; i++) {
        const item = selectedFiles[i];
        console.log(`Uploading file ${i + 1}/${selectedFiles.length}: ${item.file.name}`);

        try {
          // Apply rotation to file if needed
          let fileToUpload = item.file;
          if (item.rotation !== 0 && !item.isHeic) {
            fileToUpload = await rotateFileBlob(item.file, item.preview, item.rotation);
          }

          const formData = new FormData();
          formData.append("image", fileToUpload);
          if (sessionId) {
            formData.append("sessionId", sessionId);
            formData.append("sourceImageIndex", i.toString());
          }

          const response = await apiRequest("POST", "/api/recipes/upload", formData);
          const data = await response.json() as { recipeId: string };

          // Add to progress tracker
          addRecipe(data.recipeId, "Your Recipe");

          // Add to cookbook if selected
          if (selectedCookbookId) {
            try {
              await apiRequest("POST", `/api/cookbooks/${selectedCookbookId}/recipes`, {
                recipeId: data.recipeId,
              });
            } catch (error) {
              console.error("Failed to add recipe to cookbook:", error);
            }
          }

          console.log(`Successfully queued recipe ${i + 1}/${selectedFiles.length}`);
        } catch (error) {
          console.error(`Failed to upload file ${i + 1}:`, error);
          toast({
            title: `Upload failed for image ${i + 1}`,
            description: error instanceof Error ? error.message : "Failed to process recipe",
            variant: "destructive",
          });
        }
      }

      // Show success toast
      if (selectedFiles.length === 1) {
        toast({
          title: "Recipe queued!",
          description: "Grandma is enriching your recipe. Track progress at the top!",
        });
      } else {
        toast({
          title: `${selectedFiles.length} recipes queued!`,
          description: "Grandma is enriching your recipes. Track progress at the top!",
        });
      }

      // Invalidate recipes cache
      await queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === '/api/recipes'
      });

      // Close modal after brief delay
      setTimeout(() => {
        onOpenChange(false);
        navigate('/');
        resetModal();
      }, 800);
    } catch (error) {
      console.error("Upload error:", error);
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to process recipes",
        variant: "destructive",
      });
      setStep(1);
    }
  };

  // Handle single recipe upload (multiple images combined into one recipe)
  const handleSingleRecipeUpload = async () => {
    console.log("handleSingleRecipeUpload called, files:", selectedFiles.length);
    if (selectedFiles.length === 0) {
      console.error("No files selected!");
      return;
    }

    showQueuedConfirmation();

    try {
      const formData = new FormData();
      
      // Process and add all images to FormData
      for (let i = 0; i < selectedFiles.length; i++) {
        const item = selectedFiles[i];
        let fileToUpload = item.file;
        
        // Apply rotation to file if needed
        if (item.rotation !== 0 && !item.isHeic) {
          fileToUpload = await rotateFileBlob(item.file, item.preview, item.rotation);
        }
        
        formData.append("images", fileToUpload);
      }

      const response = await apiRequest("POST", "/api/recipes/upload-multi-image", formData);
      const data = await response.json() as { recipeId: string };

      // Add to progress tracker
      addRecipe(data.recipeId, "Your Recipe");

      // Add to cookbook if selected
      if (selectedCookbookId) {
        try {
          await apiRequest("POST", `/api/cookbooks/${selectedCookbookId}/recipes`, {
            recipeId: data.recipeId,
          });
        } catch (error) {
          console.error("Failed to add recipe to cookbook:", error);
        }
      }

      // Show success toast
      toast({
        title: "Recipe queued!",
        description: `${selectedFiles.length} images combined into one recipe. Track progress at the top!`,
      });

      // Invalidate recipes cache
      await queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === '/api/recipes'
      });

      // Close modal after brief delay
      setTimeout(() => {
        onOpenChange(false);
        navigate('/');
        resetModal();
      }, 800);
    } catch (error) {
      console.error("Upload error:", error);
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to process recipe",
        variant: "destructive",
      });
      setStep(1);
    }
  };

  // Helper to rotate a file blob
  const rotateFileBlob = async (file: File, preview: string, rotation: number): Promise<File> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = preview;

      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }

        const radians = (rotation * Math.PI) / 180;
        const sin = Math.abs(Math.sin(radians));
        const cos = Math.abs(Math.cos(radians));
        canvas.width = img.height * sin + img.width * cos;
        canvas.height = img.height * cos + img.width * sin;

        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(radians);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);

        canvas.toBlob((blob) => {
          if (blob) {
            resolve(new File([blob], file.name, { type: file.type }));
          } else {
            reject(new Error('Failed to create blob'));
          }
        }, file.type);
      };

      img.onerror = () => reject(new Error('Failed to load image'));
    });
  };

  const handleUrlSubmit = (values: z.infer<typeof urlSchema>) => {
    showQueuedConfirmation();
    urlMutation.mutate(values.url);
  };

  const handleTextSubmit = () => {
    if (recipeText.trim().length < 20) {
      toast({
        title: "Text too short",
        description: "Please paste a complete recipe with ingredients and instructions.",
        variant: "destructive",
      });
      return;
    }
    showQueuedConfirmation();
    textMutation.mutate(recipeText);
  };

  // Helper to check if a string looks like a valid URL
  const isValidUrl = (url: string): boolean => {
    try {
      new URL(url);
      return true;
    } catch {
      // Try with https:// prefix
      try {
        new URL("https://" + url);
        return url.includes(".");
      } catch {
        return false;
      }
    }
  };

  // Detect platform from URL as user types
  const handleLinkUrlChange = (url: string) => {
    setLinkUrl(url);
    const lowerUrl = url.toLowerCase().trim();
    
    if (lowerUrl.includes("instagram.com") && (lowerUrl.includes("/p/") || lowerUrl.includes("/reel/"))) {
      setDetectedPlatform("instagram");
    } else if (lowerUrl.includes("tiktok.com") && (lowerUrl.includes("/video/") || lowerUrl.includes("/t/"))) {
      setDetectedPlatform("tiktok");
    } else if (isValidUrl(url.trim())) {
      // Any valid URL that isn't social media is treated as web
      setDetectedPlatform("web");
    } else {
      setDetectedPlatform(null);
    }
  };

  const handleLinkSubmit = () => {
    const trimmedUrl = linkUrl.trim();
    if (!trimmedUrl) {
      toast({
        title: "URL required",
        description: "Please enter a URL to import a recipe.",
        variant: "destructive",
      });
      return;
    }
    
    // Ensure URL has a scheme
    let finalUrl = trimmedUrl;
    if (!trimmedUrl.startsWith("http://") && !trimmedUrl.startsWith("https://")) {
      finalUrl = "https://" + trimmedUrl;
    }
    
    // Validate URL
    try {
      new URL(finalUrl);
    } catch {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid URL.",
        variant: "destructive",
      });
      return;
    }
    
    showQueuedConfirmation();
    
    // Route to correct mutation based on platform
    if (detectedPlatform === "instagram" || detectedPlatform === "tiktok") {
      socialMutation.mutate(finalUrl);
    } else {
      urlMutation.mutate(finalUrl);
    }
  };

  const resetModal = () => {
    setStep(1);
    setMode("image");
    setImageMode("single");
    setSelectedFiles([]);
    setDragActive(false);
    setSelectedCookbookId(undefined);
    setUploadingCount(0);
    setRecipeText("");
    setLinkUrl("");
    setDetectedPlatform(null);
    urlForm.reset();
  };

  const removeFile = (id: string) => {
    setSelectedFiles(prev => prev.filter(item => item.id !== id));
  };

  const rotateFile = (id: string, degrees: number) => {
    setSelectedFiles(prev => prev.map(item => {
      if (item.id !== id || item.isHeic) return item;

      const newRotation = (item.rotation + degrees + 360) % 360;

      // Create rotated preview
      const img = new Image();
      img.src = item.preview;

      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const radians = (newRotation * Math.PI) / 180;
        const sin = Math.abs(Math.sin(radians));
        const cos = Math.abs(Math.cos(radians));
        canvas.width = img.height * sin + img.width * cos;
        canvas.height = img.height * cos + img.width * sin;

        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(radians);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);

        const newPreview = canvas.toDataURL();
        setSelectedFiles(current => current.map(i => 
          i.id === id ? { ...i, preview: newPreview } : i
        ));
      };

      return { ...item, rotation: newRotation };
    }));
  };

  const handleClose = (isOpen: boolean) => {
    // Only proceed if trying to close (isOpen === false)
    if (!isOpen) {
      onOpenChange(false);
      setTimeout(resetModal, 300);
    }
  };

  const handleTabChange = (value: string) => {
    // Only allow tab switching on step 1 (not during processing)
    if (step === 1) {
      setMode(value as "image" | "link" | "text");
      // Clear mode-specific state when switching tabs
      if (value === "link") {
        setSelectedFiles([]);
        setDragActive(false);
        setRecipeText("");
      } else if (value === "text") {
        setSelectedFiles([]);
        setDragActive(false);
        setLinkUrl("");
        setDetectedPlatform(null);
      } else {
        // image mode
        setLinkUrl("");
        setDetectedPlatform(null);
        setRecipeText("");
      }
    }
  };


  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-w-[95vw] overflow-x-hidden" data-testid="modal-upload-recipe">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">
            {showAuthPrompt && "Sign In Required"}
            {!showAuthPrompt && step === 1 && mode === "image" && "Upload Handwritten Recipe"}
            {!showAuthPrompt && step === 1 && mode === "link" && "Import Recipe from Link"}
            {!showAuthPrompt && step === 1 && mode === "text" && "Paste Recipe Text"}
            {!showAuthPrompt && step === 2 && "Recipe Queued!"}
          </DialogTitle>
          {showAuthPrompt && (
            <DialogDescription>
              Create a free account to upload and manage your recipes
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-6">
          {showAuthPrompt && (
            <div className="space-y-6 py-4">
              <div className="flex flex-col items-center text-center">
                <div className="relative w-32 h-32 mb-4">
                  <img
                    src={grandmaImage}
                    alt="Grandma"
                    className="w-full h-full object-contain rounded-lg"
                  />
                </div>
                <p className="text-muted-foreground max-w-md mb-6">
                  To upload recipes, you'll need a free account. Sign in with Google, GitHub, or create a local account.
                </p>
                <div className="flex gap-3 w-full max-w-sm">
                  <Button
                    variant="default"
                    className="flex-1"
                    onClick={() => window.location.href = '/login'}
                    data-testid="button-sign-in-replit"
                  >
                    Sign In
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      onOpenChange(false);
                      navigate('/signup');
                    }}
                    data-testid="button-create-account"
                  >
                    Create Account
                  </Button>
                </div>
              </div>
            </div>
          )}

          {!showAuthPrompt && step === 1 && (
            <Tabs value={mode} onValueChange={handleTabChange}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="image" data-testid="tab-image-upload">
                  <Upload className="h-4 w-4 mr-2" />
                  Image
                </TabsTrigger>
                <TabsTrigger value="link" data-testid="tab-link-import">
                  <Link2 className="h-4 w-4 mr-2" />
                  Link
                </TabsTrigger>
                <TabsTrigger value="text" data-testid="tab-text-paste">
                  <FileText className="h-4 w-4 mr-2" />
                  Text
                </TabsTrigger>
              </TabsList>

              <TabsContent value="image" className="space-y-4 mt-4">
                {/* Image mode toggle */}
                <div className="flex gap-2 p-1 bg-muted rounded-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setImageMode("single");
                      setSelectedFiles([]);
                    }}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                      imageMode === "single"
                        ? "bg-background shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    data-testid="button-single-recipe-mode"
                  >
                    <Layers className="h-4 w-4" />
                    Single Recipe
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setImageMode("batch");
                      setSelectedFiles([]);
                    }}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
                      imageMode === "batch"
                        ? "bg-background shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    data-testid="button-batch-upload-mode"
                  >
                    <Images className="h-4 w-4" />
                    Batch Upload
                  </button>
                </div>

                {/* Mode description */}
                <p className="text-sm text-muted-foreground text-center">
                  {imageMode === "single" 
                    ? "Upload multiple images (front & back) that combine into ONE recipe"
                    : "Upload multiple images where each becomes a SEPARATE recipe"
                  }
                </p>

                {/* Dropzone */}
                <div
                  className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                    dragActive
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  } ${selectedFiles.length > 0 ? "hidden" : ""}`}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                  data-testid="dropzone-upload"
                >
                  <Upload className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                  <h3 className="text-base font-semibold mb-1">
                    {imageMode === "single" 
                      ? "Drop recipe images here"
                      : "Drop your recipe images here"
                    }
                  </h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    {imageMode === "single"
                      ? "Upload up to 5 images for one recipe"
                      : "Upload up to 10 recipes at once"
                    }
                  </p>
                  <input
                    type="file"
                    id="file-upload"
                    className="hidden"
                    accept="image/*,.heic,.heif"
                    multiple
                    onChange={handleFileInput}
                    data-testid="input-file-upload"
                  />
                  <label htmlFor="file-upload">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => document.getElementById("file-upload")?.click()}
                      data-testid="button-browse-files"
                    >
                      Browse Files
                    </Button>
                  </label>
                </div>

                {selectedFiles.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm text-muted-foreground truncate">
                        {selectedFiles.length} {selectedFiles.length === 1 ? 'image' : 'images'} selected
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedFiles([])}
                        className="shrink-0"
                        data-testid="button-clear-all"
                      >
                        Clear
                      </Button>
                    </div>

                    {/* Thumbnail Grid */}
                    <div className="grid grid-cols-2 gap-4 max-h-64 overflow-y-auto">
                      {selectedFiles.map((item, index) => (
                        <div
                          key={item.id}
                          className="relative group rounded-lg border overflow-hidden"
                          data-testid={`thumbnail-${item.id}`}
                        >
                          {imageMode === "single" && (
                            <div className="absolute top-2 left-2 z-10 bg-primary text-primary-foreground text-xs font-medium px-2 py-1 rounded">
                              {index + 1}
                            </div>
                          )}
                          <img
                            src={item.preview}
                            alt={item.file.name}
                            className="w-full h-32 object-cover"
                          />
                          
                          {/* Overlay with controls */}
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                            {!item.isHeic && (
                              <>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="icon"
                                  onClick={() => rotateFile(item.id, -90)}
                                  data-testid={`button-rotate-left-${item.id}`}
                                >
                                  <RotateCcw className="h-4 w-4" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="icon"
                                  onClick={() => rotateFile(item.id, 90)}
                                  data-testid={`button-rotate-right-${item.id}`}
                                >
                                  <RotateCw className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                            <Button
                              type="button"
                              variant="destructive"
                              size="icon"
                              onClick={() => removeFile(item.id)}
                              data-testid={`button-remove-${item.id}`}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>

                          {/* Filename */}
                          <div className="absolute bottom-0 left-0 right-0 bg-black/80 text-white text-xs p-1 truncate">
                            {item.file.name}
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Add to Cookbook (Optional)</label>
                      <CookbookSelect
                        value={selectedCookbookId}
                        onValueChange={setSelectedCookbookId}
                      />
                    </div>
                    
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => document.getElementById("file-upload")?.click()}
                        disabled={selectedFiles.length >= (imageMode === "single" ? 5 : 10)}
                        data-testid="button-add-more"
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Add More (Max {imageMode === "single" ? 5 : 10})
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={imageMode === "single" ? handleSingleRecipeUpload : handleUpload}
                        disabled={uploadingCount > 0}
                        data-testid="button-extract-recipe"
                      >
                        <Sparkles className="mr-2 h-4 w-4" />
                        Extract {selectedFiles.length} {selectedFiles.length === 1 ? 'Recipe' : 'Recipes'} with AI
                      </Button>
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="link" className="space-y-4 mt-4">
                <div className="space-y-4">
                  {/* Supported platforms icons */}
                  <div className="flex items-center justify-center gap-4 py-2">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <SiInstagram className="h-4 w-4" />
                      <span className="text-xs">Instagram</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <SiTiktok className="h-4 w-4" />
                      <span className="text-xs">TikTok</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Globe className="h-4 w-4" />
                      <span className="text-xs">Any Website</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Recipe URL</label>
                    <div className="relative">
                      <Input
                        placeholder="Paste any recipe link..."
                        value={linkUrl}
                        onChange={(e) => handleLinkUrlChange(e.target.value)}
                        data-testid="input-link-url"
                      />
                      {detectedPlatform && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 px-2 py-0.5 bg-muted rounded text-xs font-medium">
                          {detectedPlatform === "instagram" ? (
                            <>
                              <SiInstagram className="h-3 w-3" />
                              Instagram
                            </>
                          ) : detectedPlatform === "tiktok" ? (
                            <>
                              <SiTiktok className="h-3 w-3" />
                              TikTok
                            </>
                          ) : (
                            <>
                              <Globe className="h-3 w-3" />
                              Website
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Add to Cookbook (Optional)</label>
                    <CookbookSelect
                      value={selectedCookbookId}
                      onValueChange={setSelectedCookbookId}
                    />
                  </div>
                  
                  <Button
                    type="button"
                    className="w-full"
                    onClick={handleLinkSubmit}
                    disabled={
                      (detectedPlatform === "web" ? urlMutation.isPending : 
                       (detectedPlatform === "instagram" || detectedPlatform === "tiktok") ? socialMutation.isPending : 
                       false) || 
                      !linkUrl.trim() || 
                      !detectedPlatform
                    }
                    data-testid="button-import-link"
                  >
                    {detectedPlatform === "instagram" ? (
                      <SiInstagram className="mr-2 h-4 w-4" />
                    ) : detectedPlatform === "tiktok" ? (
                      <SiTiktok className="mr-2 h-4 w-4" />
                    ) : detectedPlatform === "web" ? (
                      <Globe className="mr-2 h-4 w-4" />
                    ) : (
                      <Link2 className="mr-2 h-4 w-4" />
                    )}
                    {(detectedPlatform === "web" && urlMutation.isPending) || 
                     ((detectedPlatform === "instagram" || detectedPlatform === "tiktok") && socialMutation.isPending) 
                      ? "Importing..." : 
                      detectedPlatform === "instagram" ? "Import from Instagram" :
                      detectedPlatform === "tiktok" ? "Import from TikTok" :
                      detectedPlatform === "web" ? "Import from Website" :
                      "Import Recipe"}
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  Paste a link from Instagram, TikTok, or any recipe website. Our AI will extract and enrich 
                  the recipe with normalized ingredients, nutritional info, and more.
                </p>
              </TabsContent>

              <TabsContent value="text" className="space-y-4 mt-4">
                <div className="space-y-4">
                  <Textarea
                    placeholder="Paste your recipe here...

Example:
Grandma's Chocolate Chip Cookies

Ingredients:
- 2 cups all-purpose flour
- 1 cup butter, softened
- 1 cup sugar
- 2 eggs
- 1 tsp vanilla extract
- 2 cups chocolate chips

Instructions:
1. Preheat oven to 350°F
2. Mix butter and sugar until fluffy
3. Add eggs and vanilla
4. Stir in flour and chocolate chips
5. Drop spoonfuls onto baking sheet
6. Bake 10-12 minutes until golden"
                    value={recipeText}
                    onChange={(e) => setRecipeText(e.target.value)}
                    className="min-h-[250px] font-mono text-sm"
                    data-testid="input-recipe-text"
                  />
                  
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Add to Cookbook (Optional)</label>
                    <CookbookSelect
                      value={selectedCookbookId}
                      onValueChange={setSelectedCookbookId}
                    />
                  </div>
                  
                  <Button
                    type="button"
                    className="w-full"
                    onClick={handleTextSubmit}
                    disabled={textMutation.isPending || recipeText.trim().length < 20}
                    data-testid="button-extract-text"
                  >
                    <Sparkles className="mr-2 h-4 w-4" />
                    Extract Recipe with AI
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  Paste any recipe text. Our AI will parse and enrich it with normalized ingredients, 
                  nutritional info, and more.
                </p>
              </TabsContent>
            </Tabs>
          )}

          {!showAuthPrompt && step === 2 && (
            <div className="space-y-6 py-8 text-center">
              {/* Grandma Character - Brief confirmation */}
              <div className="flex flex-col items-center">
                <div className="relative w-40 h-40 mb-4 animate-in fade-in zoom-in duration-300">
                  <img
                    src={grandmaImage}
                    alt="Grandma"
                    className="w-full h-full object-contain rounded-lg"
                  />
                  <div className="absolute -top-2 -right-2">
                    <CheckCircle2 className="h-10 w-10 text-green-600 bg-background rounded-full p-1 animate-in zoom-in duration-500" />
                  </div>
                </div>

                <h3 className="text-2xl font-serif font-semibold mb-2 text-primary animate-in fade-in slide-in-from-bottom-4 duration-500">
                  Recipe Queued!
                </h3>
                <p className="text-muted-foreground max-w-md animate-in fade-in slide-in-from-bottom-4 duration-700">
                  Grandma is now enriching your recipe in the background.
                  <strong className="block mt-2 text-foreground">Watch the progress banner at the top!</strong>
                </p>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

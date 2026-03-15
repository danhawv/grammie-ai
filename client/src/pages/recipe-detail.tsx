import { useState, useEffect } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { Recipe } from "@shared/schema";
import {
  ArrowLeft,
  Clock,
  Users,
  ChefHat,
  Minus,
  Plus,
  ImageIcon,
  Loader2,
  AlertTriangle,
  Utensils,
  Lightbulb,
  Sparkles,
  ThermometerSun,
  Timer,
  Info,
  Wine,
  Beer,
  Martini,
  Coffee,
  TrendingDown,
  TrendingUp,
  Star,
  DollarSign,
  RefreshCw,
  Trash2,
  ShoppingCart,
  Pencil,
  BookOpen,
  Flame,
  Heart,
  Drumstick,
  MoreVertical,
  Images,
  ExternalLink,
  ArrowLeftRight,
  Printer,
  Wand2,
  BookPlus,
} from "lucide-react";
import { SiInstagram, SiTiktok } from "react-icons/si";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { RecipeImageCarousel, RecipeImageManager } from "@/components/recipe-image-manager";
import { MakeYourOwnModal } from "@/components/make-your-own-modal";
import { CookbookSelect } from "@/components/cookbook-select";
import { VoiceAssistant } from "@/components/voice-assistant";
import { Mic } from "lucide-react";
import grammieImage from "@assets/image_1763329917086.png";

const isPlaceholderImage = (imageUrl?: string | null): boolean => {
  return !!imageUrl && imageUrl.startsWith("data:image/svg");
};

const formatTime = (minutes?: number | null): string => {
  if (minutes == null) return "N/A";
  
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  
  if (hours > 0 && mins > 0) {
    return `${hours} hr ${mins} mins`;
  } else if (hours > 0) {
    return `${hours} hr`;
  } else {
    return `${mins} mins`;
  }
};

const formatQuantity = (quantity?: number, unit?: string): string => {
  if (!quantity) return "";
  
  // Convert to mixed fraction for nice display
  const whole = Math.floor(quantity);
  const fraction = quantity - whole;
  
  let fractionStr = "";
  if (Math.abs(fraction - 0.125) < 0.01) fractionStr = "1/8";
  else if (Math.abs(fraction - 0.25) < 0.01) fractionStr = "1/4";
  else if (Math.abs(fraction - 0.33) < 0.01) fractionStr = "1/3";
  else if (Math.abs(fraction - 0.5) < 0.01) fractionStr = "1/2";
  else if (Math.abs(fraction - 0.67) < 0.01) fractionStr = "2/3";
  else if (Math.abs(fraction - 0.75) < 0.01) fractionStr = "3/4";
  else if (fraction > 0.01) fractionStr = fraction.toFixed(2);
  
  const quantityStr = whole > 0 
    ? (fractionStr ? `${whole} ${fractionStr}` : `${whole}`)
    : fractionStr;
  
  return `${quantityStr}${unit ? ` ${unit}` : ""}`;
};

const getEquipmentEmoji = (equipmentName: string): string => {
  const equipmentEmojiMap: Record<string, string> = {
    // Knives & Cutting Tools
    'knife': '🔪', 'chef knife': '🔪', 'paring knife': '🔪', 'bread knife': '🔪', 'cleaver': '🔪',
    'scissors': '✂️', 'kitchen scissors': '✂️', 'peeler': '🔪', 'vegetable peeler': '🔪',
    'grater': '🧀', 'cheese grater': '🧀', 'box grater': '🧀', 'mandoline': '🔪', 'zester': '🍋',
    
    // Bowls & Containers
    'bowl': '🥣', 'mixing bowl': '🥣', 'large bowl': '🥣', 'medium bowl': '🥣', 'small bowl': '🥣',
    'glass bowl': '🥣', 'metal bowl': '🥣', 'container': '📦', 'storage container': '📦',
    
    // Pots & Pans
    'pot': '🍲', 'pan': '🍳', 'saucepan': '🍲', 'stockpot': '🍲', 'dutch oven': '🍲',
    'frying pan': '🍳', 'skillet': '🍳', 'cast iron skillet': '🍳', 'nonstick pan': '🍳',
    'wok': '🍳', 'roasting pan': '🍳', 'baking sheet': '🍪', 'sheet pan': '🍪',
    'cookie sheet': '🍪', 'baking pan': '🍰', 'cake pan': '🍰', 'loaf pan': '🍞',
    'muffin tin': '🧁', 'pie dish': '🥧', 'pie pan': '🥧', 'casserole dish': '🍲',
    'baking dish': '🍲', 'grill pan': '🍖',
    
    // Utensils
    'spoon': '🥄', 'wooden spoon': '🥄', 'slotted spoon': '🥄', 'ladle': '🥄',
    'spatula': '🍴', 'turner': '🍴', 'fish spatula': '🍴', 'tongs': '🥢',
    'whisk': '🥄', 'fork': '🍴', 'serving fork': '🍴', 'rolling pin': '🥖',
    'can opener': '🥫', 'bottle opener': '🍺', 'corkscrew': '🍷',
    
    // Measuring Tools
    'measuring cup': '📏', 'measuring cups': '📏', 'measuring spoon': '📏',
    'measuring spoons': '📏', 'kitchen scale': '⚖️', 'scale': '⚖️',
    'thermometer': '🌡️', 'meat thermometer': '🌡️', 'instant read thermometer': '🌡️',
    'timer': '⏲️', 'kitchen timer': '⏲️',
    
    // Strainers & Sieves
    'strainer': '🥅', 'colander': '🥅', 'sieve': '🥅', 'fine mesh strainer': '🥅', 'chinois': '🥅',
    
    // Cutting Boards
    'cutting board': '🪵', 'chopping board': '🪵',
    
    // Baking Tools
    'oven': '🔥', 'oven mitt': '🧤', 'oven mitts': '🧤', 'pot holder': '🧤',
    'cooling rack': '🍪', 'wire rack': '🍪', 'pastry brush': '🖌️', 'pastry bag': '🎂',
    'piping bag': '🎂', 'cookie cutter': '🍪',
    
    // Appliances
    'blender': '🌪️', 'food processor': '⚙️', 'mixer': '🔄', 'stand mixer': '🔄',
    'hand mixer': '🔄', 'immersion blender': '🌪️', 'electric mixer': '🔄',
    'microwave': '📻', 'toaster': '🍞', 'toaster oven': '🍞', 'rice cooker': '🍚',
    'slow cooker': '🍲', 'crockpot': '🍲', 'instant pot': '🍲', 'pressure cooker': '🍲',
    'air fryer': '🔥', 'deep fryer': '🔥', 'coffee maker': '☕', 'espresso machine': '☕',
    'juicer': '🍊', 'meat grinder': '🥩', 'pasta maker': '🍝', 'bread machine': '🍞',
    
    // Specialized Equipment
    'mortar and pestle': '⚗️', 'garlic press': '🧄', 'citrus juicer': '🍋',
    'lemon squeezer': '🍋', 'salad spinner': '🥗', 'potato masher': '🥔',
    'ricer': '🥔', 'cheese cloth': '🧵', 'cheesecloth': '🧵', 'kitchen twine': '🧵',
    'butcher twine': '🧵', 'baster': '🦃', 'meat mallet': '🔨', 'ice cream maker': '🍦',
    'waffle iron': '🧇', 'griddle': '🥞', 'tortilla press': '🌮', 'sushi mat': '🍣',
    'bamboo steamer': '🥟', 'steamer basket': '🥟',
    
    // Specialty
    'sous vide': '🌡️', 'smoker': '💨', 'grill': '🔥', 'barbecue': '🔥', 'bbq': '🔥',
    'pizza stone': '🍕', 'pizza peel': '🍕', 'fondue pot': '🫕', 'tagine': '🍲',
    'paella pan': '🥘',
    
    // Glassware & Drinkware
    'glass': '🥤', 'wine glass': '🍷', 'champagne flute': '🥂', 'shot glass': '🥃',
    'cocktail shaker': '🍸', 'shaker': '🍸', 'jigger': '🥃', 'muddler': '🍹',
    'bar strainer': '🍸', 'bar spoon': '🥄',
  };
  
  const normalized = equipmentName.toLowerCase().trim();
  if (equipmentEmojiMap[normalized]) return equipmentEmojiMap[normalized];
  
  for (const [key, emoji] of Object.entries(equipmentEmojiMap)) {
    if (normalized.includes(key)) return emoji;
  }
  
  return '🔧';
};

const getSeverityColor = (severity?: string) => {
  switch (severity) {
    case "error": return "destructive";
    case "warning": return "default";
    case "info": return "secondary";
    default: return "secondary";
  }
};

const IS_DEBUG = import.meta.env.DEV;

interface SourceAttributionCardProps {
  platform: 'instagram' | 'tiktok';
  sourceUrl: string;
  creatorUsername?: string | null;
  creatorAvatar?: string | null;
}

function SourceAttributionCard({
  platform,
  sourceUrl,
  creatorUsername,
  creatorAvatar,
}: SourceAttributionCardProps) {
  const platformConfig: Record<string, {
    name: string;
    icon: typeof SiInstagram | typeof SiTiktok | typeof ExternalLink;
    color: string;
    bgColor: string;
  }> = {
    instagram: {
      name: 'Instagram',
      icon: SiInstagram,
      color: 'text-pink-500',
      bgColor: 'bg-gradient-to-r from-purple-500 via-pink-500 to-orange-500',
    },
    tiktok: {
      name: 'TikTok',
      icon: SiTiktok,
      color: 'text-foreground',
      bgColor: 'bg-black dark:bg-white',
    },
  };

  const config = platformConfig[platform] || {
    name: 'Social Media',
    icon: ExternalLink,
    color: 'text-muted-foreground',
    bgColor: 'bg-muted',
  };
  const PlatformIcon = config.icon;

  return (
    <Card className="overflow-hidden">
      <CardContent className="pt-4 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {creatorAvatar ? (
              <Avatar className="h-10 w-10 border-2 border-muted flex-shrink-0">
                <AvatarImage src={creatorAvatar} alt={creatorUsername || 'Creator'} />
                <AvatarFallback>
                  <PlatformIcon className="h-5 w-5" />
                </AvatarFallback>
              </Avatar>
            ) : (
              <div className={`h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 ${platform === 'instagram' ? config.bgColor : 'bg-muted'}`}>
                <PlatformIcon className={`h-5 w-5 ${platform === 'instagram' ? 'text-white' : config.color}`} />
              </div>
            )}
            <div className="flex flex-col min-w-0">
              <span className="text-sm text-muted-foreground">
                Imported from {config.name}
              </span>
              {creatorUsername && (
                <span className="font-medium truncate" data-testid="text-source-creator">
                  @{creatorUsername}
                </span>
              )}
            </div>
          </div>
          
          <Button
            variant="outline"
            size="sm"
            asChild
            className="flex-shrink-0 self-start sm:self-center"
            data-testid="button-view-original-post"
          >
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-1.5" />
              View Original
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function RecipeDetail() {
  const [, params] = useRoute("/recipe/:id");
  const recipeId = params?.id;
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // Scroll to top when navigating to a recipe
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [recipeId]);

  const [servings, setServings] = useState<number>(1);
  const [checkedIngredients, setCheckedIngredients] = useState<Set<number>>(
    new Set()
  );
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [modalImage, setModalImage] = useState<string>("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [imageManagerOpen, setImageManagerOpen] = useState(false);
  const [makeYourOwnOpen, setMakeYourOwnOpen] = useState(false);
  const [addToCookbookOpen, setAddToCookbookOpen] = useState(false);
  const [selectedCookbookId, setSelectedCookbookId] = useState<string | undefined>();
  
  // Progressive image loading state
  const [displayImage, setDisplayImage] = useState<string | null>(null);
  const [imageOpacity, setImageOpacity] = useState(1);
  
  // Instructions toggle state (AI-enhanced vs original)
  const [showOriginalInstructions, setShowOriginalInstructions] = useState(false);

  const { data: recipe, isLoading } = useQuery<Recipe>({
    queryKey: ["/api/recipes", recipeId],
    enabled: !!recipeId,
    refetchInterval: (query: any) => {
      const data = query.state.data;
      if (!data) return false;
      
      // Poll every 3s if enrichment, content enrichment, or image generation is in progress
      const enrichmentInProgress =
        data.enrichmentStatus === 'enriching' ||
        data.enrichmentStatus === 'extracting';

      const contentEnrichmentInProgress =
        data.contentEnrichmentStatus === 'enriching';

      const imageGenerationInProgress =
        data.imageGenerationStatus === 'pending' ||
        data.imageGenerationStatus === 'generating';

      const needsPolling = enrichmentInProgress || contentEnrichmentInProgress || imageGenerationInProgress;
      
      return needsPolling ? 3000 : false;
    },
  });

  // Initialize servings when recipe loads
  useEffect(() => {
    if (recipe) {
      setServings(recipe.servings);
    }
  }, [recipe]);

  // Reset to thumbnail when recipe changes
  useEffect(() => {
    if (recipe) {
      setDisplayImage(recipe.dishImageThumbnail || recipe.dishImage || null);
      setImageOpacity(1);
    }
  }, [recipe?.id, recipe?.dishImageThumbnail, recipe?.dishImage]);

  // Load full image in background
  useEffect(() => {
    if (!recipe) return;
    
    // If we have a full image and it's different from what we're showing, load it in background
    if (recipe.dishImage && recipe.dishImage !== displayImage && !isPlaceholderImage(recipe.dishImage)) {
      let cancelled = false;
      
      const img = new Image();
      img.src = recipe.dishImage;
      img.onload = () => {
        if (!cancelled) {
          // Fade out current image
          setImageOpacity(0);
          // After fade completes, swap image and fade in
          setTimeout(() => {
            if (!cancelled) {
              setDisplayImage(recipe.dishImage);
              setImageOpacity(1);
            }
          }, 300);
        }
      };
      img.onerror = () => {
        // If full image fails to load, stick with thumbnail
      };

      // Cleanup function to prevent setState after unmount
      return () => {
        cancelled = true;
      };
    }
  }, [recipe?.dishImage, displayImage]);

  // Check if current user is owner or admin
  const isOwner = !!(user && recipe && user.id === recipe.ownerUserId);
  const isAdmin = !!(user && (user as any).isAdmin);
  
  // Owner controls: Only show for authenticated owners or admins
  const showOwnerControls = isOwner || isAdmin;
  const canDelete = showOwnerControls;

  // Recipe scaling mutation
  const scaleMutation = useMutation({
    mutationFn: async (newServings: number) => {
      const response = await apiRequest("POST", `/api/recipes/${recipeId}/scale`, { servings: newServings });
      return await response.json();
    },
    onSuccess: (data: Recipe) => {
      queryClient.setQueryData(["/api/recipes", recipeId], data);
    },
  });

  // Enrichment retry mutation
  const retryEnrichmentMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/recipes/${recipeId}/enrich`, {});
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recipes", recipeId] });
    },
  });

  // Force re-enrichment mutation
  const forceEnrichMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/recipes/${recipeId}/enrich?force=true`, {});
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: "Enrichment queued",
        description: "Recipe enrichment has been queued and will complete shortly.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes", recipeId] });
    },
    onError: (error: Error) => {
      toast({
        title: "Enrichment failed",
        description: error.message || "Failed to queue enrichment",
        variant: "destructive",
      });
    },
  });

  // Regenerate image mutation
  const regenerateImageMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/recipes/${recipeId}/regenerate-image`, {});
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: "Image generation queued",
        description: "New dish image generation has been queued.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/recipes", recipeId] });
    },
    onError: (error: Error) => {
      toast({
        title: "Image generation failed",
        description: error.message || "Failed to queue image generation",
        variant: "destructive",
      });
    },
  });

  // Add to grocery list mutation
  const addToGroceryListMutation = useMutation({
    mutationFn: async () => {
      if (!user) {
        throw new Error("AUTH_REQUIRED");
      }
      return apiRequest('POST', `/api/grocery-list/recipes/${recipeId}`);
    },
    onSuccess: () => {
      toast({
        title: "Added to grocery list",
        description: "Recipe ingredients added to your grocery list",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/grocery-list'] });
      queryClient.invalidateQueries({ queryKey: ['/api/grocery-list/by-aisle'] });
    },
    onError: (error: Error) => {
      if (error.message === "AUTH_REQUIRED" || error.message?.includes("401") || error.message?.includes("Unauthorized") || error.message?.includes("not authenticated")) {
        toast({
          title: "Sign in required",
          description: "You need to be logged in to use this feature",
          action: (
            <Button variant="outline" size="sm" onClick={() => setLocation("/auth")}>
              Sign In
            </Button>
          ),
        });
      } else {
        toast({
          title: "Failed to add to grocery list",
          description: error.message || "An error occurred",
          variant: "destructive",
        });
      }
    },
  });

  // Add to cookbook mutation
  const addToCookbookMutation = useMutation({
    mutationFn: async (cookbookId: string) => {
      const response = await apiRequest("POST", `/api/cookbooks/${cookbookId}/recipes`, {
        recipeId,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Recipe added to cookbook",
      });
      setAddToCookbookOpen(false);
      setSelectedCookbookId(undefined);
      queryClient.invalidateQueries({ queryKey: ["/api/cookbooks"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add recipe",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    },
  });

  // Delete recipe mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("DELETE", `/api/recipes/${recipeId}`);
      return response;
    },
    onSuccess: () => {
      toast({
        title: "Recipe deleted successfully",
      });
      setDeleteDialogOpen(false);
      setLocation("/");
    },
    onError: async (error: any) => {
      let errorMessage = "An error occurred while deleting the recipe";
      
      if (error instanceof Response) {
        try {
          const errorData = await error.json();
          errorMessage = errorData.message || errorData.error || error.statusText;
        } catch {
          errorMessage = error.statusText || errorMessage;
        }
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      toast({
        title: "Failed to delete recipe",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const handleServingsChange = (newServings: number) => {
    if (newServings < 1) return;
    setServings(newServings);
    scaleMutation.mutate(newServings);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Skeleton className="w-full h-[500px]" />
        <div className="max-w-4xl mx-auto px-4 py-8 md:py-12">
          <div className="space-y-6">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-96 w-full" />
            <Skeleton className="h-96 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!recipe) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <ChefHat className="h-24 w-24 text-muted-foreground mx-auto mb-6" />
          <h2 className="text-2xl font-serif font-semibold mb-2">
            Recipe not found
          </h2>
          <Link href="/">
            <Button>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to recipes
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const toggleIngredient = (index: number) => {
    const newChecked = new Set(checkedIngredients);
    if (newChecked.has(index)) {
      newChecked.delete(index);
    } else {
      newChecked.add(index);
    }
    setCheckedIngredients(newChecked);
  };

  const openImageModal = (image: string) => {
    setModalImage(image);
    setImageModalOpen(true);
  };

  // Determine which dietary flags are active
  const activeDietaryFlags = [];
  if (recipe.isVegetarian) activeDietaryFlags.push("Vegetarian");
  if (recipe.isVegan) activeDietaryFlags.push("Vegan");
  if (recipe.isPescatarian) activeDietaryFlags.push("Pescatarian");
  if (recipe.isGlutenFree) activeDietaryFlags.push("Gluten-Free");
  if (recipe.isDairyFree) activeDietaryFlags.push("Dairy-Free");
  if (recipe.isKeto) activeDietaryFlags.push("Keto");
  if (recipe.isPaleo) activeDietaryFlags.push("Paleo");
  if (recipe.isLowCarb) activeDietaryFlags.push("Low-Carb");
  if (recipe.isHighProtein) activeDietaryFlags.push("High-Protein");
  if (recipe.isLowCalorie) activeDietaryFlags.push("Low-Calorie");
  if (recipe.isHighFiber) activeDietaryFlags.push("High-Fiber");
  if (recipe.isLactoVegetarian) activeDietaryFlags.push("Lacto-Vegetarian");
  if (recipe.isMediterranean) activeDietaryFlags.push("Mediterranean");
  if (recipe.isOvoVegetarian) activeDietaryFlags.push("Ovo-Vegetarian");
  if (recipe.isOvoLactoVegetarian) activeDietaryFlags.push("Ovo-Lacto-Vegetarian");
  if (recipe.isFlexitarian) activeDietaryFlags.push("Flexitarian");
  if (recipe.isCarnivore) activeDietaryFlags.push("Carnivore");
  if (recipe.isKosher) activeDietaryFlags.push("Kosher");
  if (recipe.isHalal) activeDietaryFlags.push("Halal");
  if (recipe.isHindu) activeDietaryFlags.push("Hindu");
  
  // Nutrition quality tags
  const nutritionQualityTags = [];
  if (recipe.isLowFat) nutritionQualityTags.push("Low-Fat");
  if (recipe.isLowSodium) nutritionQualityTags.push("Low-Sodium");
  if (recipe.isLowSugar) nutritionQualityTags.push("Low-Sugar");

  // Use normalized ingredients/instructions if available, otherwise fallback to raw
  const displayIngredients = recipe.normalizedIngredients && recipe.normalizedIngredients.length > 0
    ? recipe.normalizedIngredients
    : (recipe.ingredients ?? []).map((raw: string) => ({ raw, item: raw }));
  
  const displayInstructions = recipe.normalizedInstructions && recipe.normalizedInstructions.length > 0
    ? recipe.normalizedInstructions
    : (recipe.instructions ?? []).map((text: string, idx: number) => ({ stepNumber: idx + 1, text, ingredients: [], tools: [] }));

  // Group tips by type
  const tipsByType = recipe.tips?.reduce((acc: any, tip: any) => {
    if (!acc[tip.type]) acc[tip.type] = [];
    acc[tip.type].push(tip);
    return acc;
  }, {} as Record<string, any>);

  // Group variations by type
  const variationsByType = recipe.variations?.reduce((acc: any, variation: any) => {
    if (!acc[variation.type]) acc[variation.type] = [];
    acc[variation.type].push(variation);
    return acc;
  }, {} as Record<string, any>);

  return (
    <div className="min-h-screen bg-background">
      <div className="relative h-[500px] overflow-hidden">
        {(recipe.dishImages && recipe.dishImages.length > 0) || displayImage ? (
          <RecipeImageCarousel
            dishImages={recipe.dishImages || []}
            currentImage={displayImage}
          />
        ) : (
          <div className="w-full h-full bg-muted flex items-center justify-center">
            <img src={grammieImage} alt="Grammie" className="h-48 w-48 object-contain opacity-60" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent pointer-events-none" />
        
        {/* Status indicators overlay */}
        <div className="absolute top-8 right-8 flex flex-col gap-2 items-end">
          {isPlaceholderImage(recipe.dishImage) && (
            <Badge 
              variant="secondary" 
              className="bg-background/90 backdrop-blur-sm text-foreground gap-2 px-4 py-2 text-base"
              data-testid="badge-generating-image"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating dish image...
            </Badge>
          )}
          
          {recipe.enrichmentStatus === 'enriching' && (
            <Badge 
              variant="secondary" 
              className="bg-background/90 backdrop-blur-sm text-foreground gap-2 px-4 py-2 text-base"
              data-testid="badge-enriching"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              Enriching recipe data...
            </Badge>
          )}
          
          {recipe.enrichmentStatus === 'extracting' && (
            <Badge 
              variant="secondary" 
              className="bg-background/90 backdrop-blur-sm text-foreground gap-2 px-4 py-2 text-base"
              data-testid="badge-extracting"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              Extracting recipe...
            </Badge>
          )}
          
          {recipe.enrichmentStatus === 'failed' && (
            <div className="flex flex-col gap-2">
              <Badge 
                variant="destructive" 
                className="bg-destructive/90 backdrop-blur-sm text-destructive-foreground gap-2 px-4 py-2 text-base"
                data-testid="badge-enrichment-failed"
              >
                <AlertTriangle className="h-4 w-4" />
                Enrichment failed
              </Badge>
              {recipe.enrichmentError && (
                <p className="text-xs text-destructive-foreground bg-destructive/60 backdrop-blur-sm px-3 py-2 rounded-md" data-testid="text-enrichment-error">
                  {recipe.enrichmentError}
                </p>
              )}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => retryEnrichmentMutation.mutate()}
                disabled={retryEnrichmentMutation.isPending}
                className="bg-background/90 backdrop-blur-sm"
                data-testid="button-retry-enrichment"
              >
                {retryEnrichmentMutation.isPending ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                    Retrying...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3 w-3 mr-2" />
                    Retry Enrichment
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Image generation status badges */}
          {recipe.imageGenerationStatus === 'generating' && (
            <Badge 
              variant="secondary" 
              className="bg-background/90 backdrop-blur-sm text-foreground gap-2 px-4 py-2 text-base"
              data-testid="badge-image-generating"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating dish image...
            </Badge>
          )}

          {recipe.imageGenerationStatus === 'failed' && (
            <div className="flex flex-col gap-2">
              <Badge 
                variant="destructive" 
                className="bg-destructive/90 backdrop-blur-sm text-destructive-foreground gap-2 px-4 py-2 text-base"
                data-testid="badge-image-failed"
              >
                <AlertTriangle className="h-4 w-4" />
                Image generation failed
              </Badge>
              {recipe.imageGenerationError && (
                <p className="text-xs text-destructive-foreground bg-destructive/60 backdrop-blur-sm px-3 py-2 rounded-md" data-testid="text-image-error">
                  {recipe.imageGenerationError}
                </p>
              )}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => regenerateImageMutation.mutate()}
                disabled={regenerateImageMutation.isPending}
                className="bg-background/90 backdrop-blur-sm"
                data-testid="button-retry-image"
              >
                {regenerateImageMutation.isPending ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                    Retrying...
                  </>
                ) : (
                  <>
                    <ImageIcon className="h-3 w-3 mr-2" />
                    Retry Image Generation
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Action buttons - stacked vertically */}
          <div className="flex flex-col gap-2">
            {/* Add to Grocery List button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => addToGroceryListMutation.mutate()}
                  disabled={addToGroceryListMutation.isPending}
                  className="bg-background/90 backdrop-blur-sm"
                  data-testid="button-add-to-grocery-list"
                >
                  {addToGroceryListMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShoppingCart className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Add to grocery list</p>
              </TooltipContent>
            </Tooltip>

            {/* Voice Cooking Assistant button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <VoiceAssistant
                    mode="cooking"
                    recipeContext={{
                      name: recipe.title || 'Recipe',
                      recipeId: recipe.id,
                      ingredients: recipe.normalizedIngredients?.map((ing: any) => ing.raw || ing.item) || [],
                      instructions: recipe.normalizedInstructions?.map((inst: any) => inst.text) || (Array.isArray(recipe.instructions) ? recipe.instructions : []),
                    }}
                    trigger={
                      <Button
                        size="icon"
                        variant="ghost"
                        className="bg-background/90 backdrop-blur-sm"
                        data-testid="button-cooking-assistant"
                      >
                        <Mic className="h-4 w-4" />
                      </Button>
                    }
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>Hands-free cooking mode</p>
              </TooltipContent>
            </Tooltip>

            {/* Recipe actions dropdown menu - visible to all users */}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="bg-background/90 backdrop-blur-sm"
                      data-testid="button-recipe-actions"
                      aria-label="Recipe actions menu"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>More options</p>
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-48">
                {isOwner && (
                  <Link href={`/recipe/${recipeId}/edit`}>
                    <DropdownMenuItem data-testid="menu-edit-recipe">
                      <Pencil className="h-4 w-4 mr-2" />
                      Edit Recipe
                    </DropdownMenuItem>
                  </Link>
                )}
                {showOwnerControls && (
                  <>
                    <DropdownMenuItem 
                      onClick={() => forceEnrichMutation.mutate()}
                      disabled={forceEnrichMutation.isPending || (recipe.enrichmentStatus !== 'ready' && recipe.enrichmentStatus !== 'failed')}
                      data-testid="menu-re-enrich"
                    >
                      {forceEnrichMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4 mr-2" />
                      )}
                      Re-enrich
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={() => setImageManagerOpen(true)}
                      data-testid="menu-manage-images"
                    >
                      <Images className="h-4 w-4 mr-2" />
                      Manage Images
                    </DropdownMenuItem>
                  </>
                )}
                {/* Add to Cookbook - available to authenticated users */}
                {user && (
                  <DropdownMenuItem 
                    onClick={() => setAddToCookbookOpen(true)}
                    data-testid="menu-add-to-cookbook"
                  >
                    <BookPlus className="h-4 w-4 mr-2" />
                    Add to Cookbook
                  </DropdownMenuItem>
                )}
                {/* Print is available to all users */}
                <DropdownMenuItem 
                  onClick={() => window.print()}
                  data-testid="menu-print-recipe"
                >
                  <Printer className="h-4 w-4 mr-2" />
                  Print Recipe
                </DropdownMenuItem>
                {canDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem 
                      onClick={() => setDeleteDialogOpen(true)}
                      disabled={deleteMutation.isPending}
                      className="text-destructive focus:text-destructive"
                      data-testid="menu-delete-recipe"
                    >
                      {deleteMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4 mr-2" />
                      )}
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        
        <div className="absolute top-8 left-8">
          <Tooltip>
            <TooltipTrigger asChild>
              <Link href="/">
                <Button
                  size="icon"
                  variant="ghost"
                  className="bg-background/90 backdrop-blur-sm"
                  data-testid="button-back-to-recipes"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </Link>
            </TooltipTrigger>
            <TooltipContent>
              <p>Back to recipes</p>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="absolute bottom-0 left-0 right-0 p-8">
          <div className="max-w-7xl mx-auto">
            <h1
              className="font-serif text-4xl md:text-5xl lg:text-6xl font-bold text-white"
              data-testid="text-recipe-title"
            >
              {recipe.title}
            </h1>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 md:py-12">
        <div className="space-y-6">
          {/* Quick Info Card */}
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div className="flex items-center gap-3">
                  <Clock className="h-5 w-5 text-primary flex-shrink-0" />
                  <div>
                    <div className="text-xs text-muted-foreground">Prep Time</div>
                    <div className="font-medium" data-testid="text-prep-time">
                      {formatTime(recipe.prepTimeMinutes)}
                    </div>
                  </div>
                </div>
                {recipe.cookTimeMinutes != null && (
                  <div className="flex items-center gap-3">
                    <Clock className="h-5 w-5 text-primary flex-shrink-0" />
                    <div>
                      <div className="text-xs text-muted-foreground">Cook Time</div>
                      <div className="font-medium" data-testid="text-cook-time">
                        {formatTime(recipe.cookTimeMinutes)}
                      </div>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <Clock className="h-5 w-5 text-primary flex-shrink-0" />
                  <div>
                    <div className="text-xs text-muted-foreground">Total Time</div>
                    <div className="font-medium" data-testid="text-total-time">
                      {formatTime(recipe.totalTimeMinutes)}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-primary" />
                    <span className="text-xs text-muted-foreground">
                      Servings
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => handleServingsChange(servings - 1)}
                      disabled={servings <= 1 || scaleMutation.isPending}
                      data-testid="button-decrease-servings"
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <span
                      className="font-mono text-lg font-semibold w-12 text-center relative"
                      data-testid="text-servings-count"
                    >
                      {servings}
                      {scaleMutation.isPending && (
                        <Loader2 className="h-3 w-3 animate-spin absolute -right-4 top-1/2 -translate-y-1/2" />
                      )}
                    </span>
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => handleServingsChange(servings + 1)}
                      disabled={scaleMutation.isPending}
                      data-testid="button-increase-servings"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
              
            </CardContent>
          </Card>

          {/* Make Your Own button - below time/servings card */}
          {user && !recipe.derivedFromRecipeId && (
            <Button
              variant="outline"
              size="lg"
              className="w-full gap-2"
              onClick={() => setMakeYourOwnOpen(true)}
              data-testid="button-make-your-own"
            >
              <Wand2 className="h-5 w-5" />
              Make Your Own
            </Button>
          )}

          {/* Social Media Source Attribution */}
          {recipe.socialSourcePlatform && recipe.socialSourceUrl && (
            <SourceAttributionCard
              platform={recipe.socialSourcePlatform as 'instagram' | 'tiktok'}
              sourceUrl={recipe.socialSourceUrl}
              creatorUsername={recipe.socialSourceCreatorUsername}
              creatorAvatar={recipe.socialSourceCreatorAvatar}
            />
          )}

          {/* Variation Attribution */}
          {recipe.derivedFromRecipeId && (
            <Card className="overflow-hidden">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Wand2 className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-muted-foreground">Personalized Variation</p>
                    {recipe.variationNotes && (
                      <p className="text-sm font-medium" data-testid="text-variation-notes">
                        {recipe.variationNotes}
                      </p>
                    )}
                  </div>
                  <Link href={`/recipe/${recipe.derivedFromRecipeId}`}>
                    <Button variant="outline" size="sm" data-testid="button-view-original-recipe">
                      <ArrowLeftRight className="h-4 w-4 mr-1.5" />
                      View Original
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Original Author's Notes */}
          {recipe.description && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="font-serif text-lg flex items-center gap-2">
                  <Info className="h-5 w-5 text-primary" />
                  Original Author's Notes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p 
                  className="text-muted-foreground leading-relaxed"
                  data-testid="text-recipe-description"
                >
                  {recipe.description}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Ingredients Card */}
          <Card>
            <CardHeader className="gap-2">
              <CardTitle className="font-serif text-2xl">
                Ingredients
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-0">
                {displayIngredients.map((ingredient: any, index: number) => {
                  const quantityStr = formatQuantity(ingredient.quantity, ingredient.unit);
                  const isChecked = checkedIngredients.has(index);
                  
                  return (
                    <div
                      key={index}
                      className={`
                        flex items-center gap-3 py-2.5 border-b border-border/50 last:border-b-0 cursor-pointer
                        transition-opacity duration-200
                        ${isChecked ? 'opacity-50' : ''}
                      `}
                      onClick={() => toggleIngredient(index)}
                      data-testid={`ingredient-row-${index}`}
                    >
                      {/* Circle Checkbox */}
                      <div 
                        className={`
                          w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0
                          transition-colors duration-200
                          ${isChecked 
                            ? 'border-primary bg-primary' 
                            : 'border-muted-foreground/30'
                          }
                        `}
                        data-testid={`checkbox-ingredient-${index}`}
                      >
                        {isChecked && (
                          <svg className="w-2.5 h-2.5 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>

                      {/* Emoji */}
                      {ingredient.emoji && (
                        <span className="text-lg flex-shrink-0" data-testid={`emoji-ingredient-${index}`}>
                          {ingredient.emoji}
                        </span>
                      )}

                      {/* Ingredient Name - Left side */}
                      <span 
                        className={`
                          flex-1 text-base
                          ${isChecked ? 'line-through text-muted-foreground' : 'text-foreground'}
                        `}
                        data-testid={`text-ingredient-${index}`}
                      >
                        {ingredient.item}
                        {ingredient.preparation && (
                          <span className="text-muted-foreground">, {ingredient.preparation}</span>
                        )}
                        {ingredient.isOptional && (
                          <span className="text-muted-foreground text-sm ml-1">(optional)</span>
                        )}
                      </span>

                      {/* Quantity - Right side */}
                      {quantityStr && (
                        <span className={`text-sm whitespace-nowrap ${isChecked ? 'text-muted-foreground/70' : 'text-muted-foreground'}`}>
                          {quantityStr}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Instructions Card */}
          <Card>
            <CardHeader className="gap-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="font-serif text-2xl">
                  Instructions
                </CardTitle>
                <div className="flex items-center gap-2">
                  {recipe.instructionsGenerated && (
                    <Badge variant="outline" className="gap-1 text-xs" data-testid="badge-instructions-generated">
                      <Sparkles className="h-3 w-3" />
                      {showOriginalInstructions ? "Original" : "AI Generated"}
                    </Badge>
                  )}
                  {/* Toggle button - only show if we have original instructions to compare */}
                  {recipe.instructionsGenerated && recipe.originalInstructions && recipe.originalInstructions.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowOriginalInstructions(!showOriginalInstructions)}
                      className="gap-1.5 text-xs"
                      data-testid="button-toggle-instructions"
                    >
                      <ArrowLeftRight className="h-3.5 w-3.5" />
                      {showOriginalInstructions ? "Show AI" : "Show Original"}
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ol className="space-y-6">
                {/* Show original simple instructions or AI-enhanced instructions based on toggle */}
                {showOriginalInstructions && recipe.originalInstructions && recipe.originalInstructions.length > 0 ? (
                  recipe.originalInstructions.map((instruction: string, index: number) => (
                    <li
                      key={index}
                      className="flex gap-4"
                      data-testid={`instruction-original-${index}`}
                    >
                      <span className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-muted text-muted-foreground font-mono font-semibold">
                        {index + 1}
                      </span>
                      <div className="flex-1 pt-1.5">
                        <p className="text-lg leading-relaxed">
                          {instruction}
                        </p>
                      </div>
                    </li>
                  ))
                ) : (
                displayInstructions.map((instruction: any, index: number) => (
                  <li
                    key={index}
                    className="flex gap-4"
                    data-testid={`instruction-${index}`}
                  >
                    <span className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-primary text-primary-foreground font-mono font-semibold">
                      {instruction.stepNumber}
                    </span>
                    <div className="flex-1 pt-1.5">
                      <p className="text-lg leading-relaxed mb-3">
                        {instruction.text}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {instruction.timeMinutes && (
                          <Badge variant="secondary" className="gap-1">
                            <Timer className="h-3 w-3" />
                            {instruction.timeMinutes} min
                          </Badge>
                        )}
                        {instruction.temperature && (
                          <Badge variant="secondary" className="gap-1">
                            <ThermometerSun className="h-3 w-3" />
                            {instruction.temperature.value}°{instruction.temperature.scale}
                          </Badge>
                        )}
                      </div>
                      {instruction.donenessCue && (
                        <div className="text-sm text-muted-foreground mt-2 italic">
                          Doneness: {instruction.donenessCue}
                        </div>
                      )}
                    </div>
                  </li>
                )))}
              </ol>
            </CardContent>
          </Card>

          {/* Recipe Details Card */}
          <Card>
            <CardHeader className="gap-2">
              <CardTitle className="font-serif text-2xl">
                Recipe Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {((recipe.cuisines && recipe.cuisines.length > 0) || recipe.cuisine) && (
                <div>
                  <div className="text-sm text-muted-foreground mb-2">
                    {recipe.cuisines && recipe.cuisines.length > 1 ? "Cuisines" : "Cuisine"}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {recipe.cuisines && recipe.cuisines.length > 0 ? (
                      (recipe.cuisines ?? []).map((cuisine: string) => (
                        <Badge key={cuisine} variant="secondary" data-testid={`badge-cuisine-${cuisine}`}>
                          {cuisine}
                        </Badge>
                      ))
                    ) : recipe.cuisine ? (
                      <Badge variant="secondary" data-testid="badge-cuisine">
                        {recipe.cuisine}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              )}
              
              {recipe.occasionTags && recipe.occasionTags.length > 0 && (
                <div>
                  <div className="text-sm text-muted-foreground mb-2">
                    Occasions
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(recipe.occasionTags ?? []).map((tag: string) => (
                      <Badge
                        key={tag}
                        variant="secondary"
                        data-testid={`badge-occasion-${tag}`}
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {recipe.cookingMethods && recipe.cookingMethods.length > 0 && (
                <div>
                  <div className="text-sm text-muted-foreground mb-2">
                    Cooking Methods
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(recipe.cookingMethods ?? []).map((method: string) => (
                      <Badge
                        key={method}
                        variant="outline"
                        data-testid={`badge-method-${method}`}
                      >
                        {method}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {recipe.seasonTags && recipe.seasonTags.length > 0 && (
                <div>
                  <div className="text-sm text-muted-foreground mb-2">
                    Seasonal
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(recipe.seasonTags ?? []).map((season: string) => (
                      <Badge
                        key={season}
                        variant="secondary"
                        data-testid={`badge-season-${season}`}
                      >
                        {season}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {(recipe.totalCost != null || recipe.costExcludingStaples != null || recipe.priceRangeMin != null || recipe.priceRangeMax != null || recipe.priceCategory) && (
                <div>
                  <div className="text-sm text-muted-foreground mb-2">
                    Estimated Cost
                  </div>
                  <div className="space-y-2">
                    {recipe.totalCost != null && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Total Recipe Cost:</span>
                        <Badge variant="outline" data-testid="badge-total-cost">
                          ${recipe.totalCost.toFixed(2)}
                        </Badge>
                      </div>
                    )}
                    {recipe.costExcludingStaples != null && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Cost (excluding staples):</span>
                        <Badge variant="outline" data-testid="badge-cost-excluding-staples">
                          ${recipe.costExcludingStaples.toFixed(2)}
                        </Badge>
                      </div>
                    )}
                    {recipe.priceRangeMin != null && recipe.priceRangeMax != null && recipe.priceRangeMin !== recipe.priceRangeMax && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Per Serving:</span>
                        <Badge variant="outline" data-testid="badge-price-range">
                          ${recipe.priceRangeMin.toFixed(2)} - ${recipe.priceRangeMax.toFixed(2)}
                        </Badge>
                      </div>
                    )}
                    {recipe.priceCategory && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Category:</span>
                        <Badge variant="secondary" data-testid="badge-price-category">
                          {recipe.priceCategory}
                        </Badge>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {recipe.skillLevel && (
                <div>
                  <div className="flex items-center gap-3">
                    <ChefHat className="h-5 w-5 text-primary" />
                    <div className="flex-1">
                      <div className="text-sm text-muted-foreground">
                        Skill Level
                      </div>
                      <div
                        className="font-medium"
                        data-testid="text-skill-level"
                      >
                        {recipe.skillLevel}
                      </div>
                      {recipe.skillLevelExplanation && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {recipe.skillLevelExplanation}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

            {/* Content enrichment loading skeleton — shown while Group 3 content loads in background */}
            {recipe.contentEnrichmentStatus === 'enriching' && !recipe.beveragePairings && !recipe.culturalSignificance && !recipe.celebrityChefReviews && (
              <Card className="border-dashed">
                <CardHeader className="gap-2">
                  <CardTitle className="font-serif text-lg flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading additional content...
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-2/3" />
                  <p className="text-xs text-muted-foreground mt-2">
                    Chef reviews, beverage pairings, and cultural context are being generated...
                  </p>
                </CardContent>
              </Card>
            )}

            {recipe.beveragePairings && (
              (recipe.beveragePairings.wines?.length > 0 ||
               recipe.beveragePairings.beers?.length > 0 ||
               recipe.beveragePairings.cocktails?.length > 0 ||
               recipe.beveragePairings.nonAlcoholic?.length > 0) && (
              <Card>
                <CardHeader className="gap-2">
                  <CardTitle className="font-serif text-2xl">
                    Beverage Pairings
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Accordion type="single" collapsible>
                    {recipe.beveragePairings.wines && recipe.beveragePairings.wines.length > 0 && (
                      <AccordionItem value="wines" className="border-0">
                        <AccordionTrigger className="py-2" data-testid="button-toggle-wines">
                          <div className="flex items-center gap-2">
                            <Wine className="h-4 w-4 text-primary" />
                            <span>Wine Pairings ({recipe.beveragePairings.wines.length})</span>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-3 pt-2">
                            {(recipe.beveragePairings.wines ?? []).map((pairing: any, idx: number) => (
                              <div key={idx} className="border-l-2 border-primary pl-3" data-testid={`pairing-wine-${idx}`}>
                                <div className="font-semibold">{pairing.name}</div>
                                {pairing.styleOrVarietal && (
                                  <div className="text-sm text-muted-foreground">{pairing.styleOrVarietal}</div>
                                )}
                                {pairing.tastingNotes && (
                                  <div className="text-sm italic mt-1">{pairing.tastingNotes}</div>
                                )}
                                <div className="text-sm mt-1">{pairing.rationale}</div>
                              </div>
                            ))}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    )}

                    {recipe.beveragePairings.beers && recipe.beveragePairings.beers.length > 0 && (
                      <AccordionItem value="beers" className="border-0">
                        <AccordionTrigger className="py-2" data-testid="button-toggle-beers">
                          <div className="flex items-center gap-2">
                            <Beer className="h-4 w-4 text-primary" />
                            <span>Beer Pairings ({recipe.beveragePairings.beers.length})</span>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-3 pt-2">
                            {(recipe.beveragePairings.beers ?? []).map((pairing: any, idx: number) => (
                              <div key={idx} className="border-l-2 border-primary pl-3" data-testid={`pairing-beer-${idx}`}>
                                <div className="font-semibold">{pairing.name}</div>
                                {pairing.styleOrVarietal && (
                                  <div className="text-sm text-muted-foreground">{pairing.styleOrVarietal}</div>
                                )}
                                {pairing.tastingNotes && (
                                  <div className="text-sm italic mt-1">{pairing.tastingNotes}</div>
                                )}
                                <div className="text-sm mt-1">{pairing.rationale}</div>
                              </div>
                            ))}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    )}

                    {recipe.beveragePairings.cocktails && recipe.beveragePairings.cocktails.length > 0 && (
                      <AccordionItem value="cocktails" className="border-0">
                        <AccordionTrigger className="py-2" data-testid="button-toggle-cocktails">
                          <div className="flex items-center gap-2">
                            <Martini className="h-4 w-4 text-primary" />
                            <span>Cocktail Pairings ({recipe.beveragePairings.cocktails.length})</span>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-3 pt-2">
                            {(recipe.beveragePairings.cocktails ?? []).map((pairing: any, idx: number) => (
                              <div key={idx} className="border-l-2 border-primary pl-3" data-testid={`pairing-cocktail-${idx}`}>
                                <div className="font-semibold">{pairing.name}</div>
                                {pairing.styleOrVarietal && (
                                  <div className="text-sm text-muted-foreground">{pairing.styleOrVarietal}</div>
                                )}
                                {pairing.tastingNotes && (
                                  <div className="text-sm italic mt-1">{pairing.tastingNotes}</div>
                                )}
                                <div className="text-sm mt-1">{pairing.rationale}</div>
                              </div>
                            ))}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    )}

                    {recipe.beveragePairings.nonAlcoholic && recipe.beveragePairings.nonAlcoholic.length > 0 && (
                      <AccordionItem value="non-alcoholic" className="border-0">
                        <AccordionTrigger className="py-2" data-testid="button-toggle-non-alcoholic">
                          <div className="flex items-center gap-2">
                            <Coffee className="h-4 w-4 text-primary" />
                            <span>Non-Alcoholic Pairings ({recipe.beveragePairings.nonAlcoholic.length})</span>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-3 pt-2">
                            {(recipe.beveragePairings.nonAlcoholic ?? []).map((pairing: any, idx: number) => (
                              <div key={idx} className="border-l-2 border-primary pl-3" data-testid={`pairing-non-alcoholic-${idx}`}>
                                <div className="font-semibold">{pairing.name}</div>
                                {pairing.styleOrVarietal && (
                                  <div className="text-sm text-muted-foreground">{pairing.styleOrVarietal}</div>
                                )}
                                {pairing.tastingNotes && (
                                  <div className="text-sm italic mt-1">{pairing.tastingNotes}</div>
                                )}
                                <div className="text-sm mt-1">{pairing.rationale}</div>
                              </div>
                            ))}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    )}
                  </Accordion>
                </CardContent>
              </Card>
              )
            )}

            {recipe.recipeVariations && (
              (recipe.recipeVariations.lowerCalorie?.length > 0 ||
               recipe.recipeVariations.higherProtein?.length > 0 ||
               recipe.recipeVariations.michelinUpgrade?.length > 0 ||
               recipe.recipeVariations.budgetFriendly?.length > 0) && (
              <Card>
                <CardHeader className="gap-2">
                  <CardTitle className="font-serif text-2xl">
                    Recipe Variations
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Accordion type="single" collapsible>
                    {recipe.recipeVariations.lowerCalorie && recipe.recipeVariations.lowerCalorie.length > 0 && (
                      <AccordionItem value="lower-calorie" className="border-0">
                        <AccordionTrigger className="py-2" data-testid="button-toggle-lower-calorie">
                          <div className="flex items-center gap-2">
                            <TrendingDown className="h-4 w-4 text-green-600" />
                            <span>Lower Calorie Options ({recipe.recipeVariations.lowerCalorie.length})</span>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-3 pt-2">
                            {(recipe.recipeVariations.lowerCalorie ?? []).map((swap: any, idx: number) => (
                              <div key={idx} className="border-l-2 border-green-600 pl-3" data-testid={`variation-lower-calorie-${idx}`}>
                                <div className="font-semibold">Replace: {swap.targetIngredient}</div>
                                <div className="text-sm">With: {swap.replacement}</div>
                                <div className="text-sm text-muted-foreground mt-1">{swap.reason}</div>
                                <div className="text-sm text-green-600 font-medium mt-1">{swap.impactSummary}</div>
                              </div>
                            ))}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    )}

                    {recipe.recipeVariations.higherProtein && recipe.recipeVariations.higherProtein.length > 0 && (
                      <AccordionItem value="higher-protein" className="border-0">
                        <AccordionTrigger className="py-2" data-testid="button-toggle-higher-protein">
                          <div className="flex items-center gap-2">
                            <TrendingUp className="h-4 w-4 text-blue-600" />
                            <span>Higher Protein Options ({recipe.recipeVariations.higherProtein.length})</span>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-3 pt-2">
                            {(recipe.recipeVariations.higherProtein ?? []).map((swap: any, idx: number) => (
                              <div key={idx} className="border-l-2 border-blue-600 pl-3" data-testid={`variation-higher-protein-${idx}`}>
                                <div className="font-semibold">Replace: {swap.targetIngredient}</div>
                                <div className="text-sm">With: {swap.replacement}</div>
                                <div className="text-sm text-muted-foreground mt-1">{swap.reason}</div>
                                <div className="text-sm text-blue-600 font-medium mt-1">{swap.impactSummary}</div>
                              </div>
                            ))}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    )}

                    {recipe.recipeVariations.michelinUpgrade && recipe.recipeVariations.michelinUpgrade.length > 0 && (
                      <AccordionItem value="michelin-upgrade" className="border-0">
                        <AccordionTrigger className="py-2" data-testid="button-toggle-michelin-upgrade">
                          <div className="flex items-center gap-2">
                            <Star className="h-4 w-4 text-yellow-600" />
                            <span>Michelin-Star Upgrades ({recipe.recipeVariations.michelinUpgrade.length})</span>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-3 pt-2">
                            {(recipe.recipeVariations.michelinUpgrade ?? []).map((enhancement: any, idx: number) => (
                              <div key={idx} className="border-l-2 border-yellow-600 pl-3" data-testid={`variation-michelin-${idx}`}>
                                <div className="flex items-center gap-2 mb-1">
                                  <Badge variant="outline" className="text-xs">{enhancement.focus}</Badge>
                                </div>
                                <div className="font-semibold">{enhancement.recommendation}</div>
                                <div className="text-sm text-muted-foreground mt-1">{enhancement.rationale}</div>
                              </div>
                            ))}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    )}

                    {recipe.recipeVariations.budgetFriendly && recipe.recipeVariations.budgetFriendly.length > 0 && (
                      <AccordionItem value="budget-friendly" className="border-0">
                        <AccordionTrigger className="py-2" data-testid="button-toggle-budget-friendly">
                          <div className="flex items-center gap-2">
                            <DollarSign className="h-4 w-4 text-purple-600" />
                            <span>Budget-Friendly Options ({recipe.recipeVariations.budgetFriendly.length})</span>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-3 pt-2">
                            {(recipe.recipeVariations.budgetFriendly ?? []).map((swap: any, idx: number) => (
                              <div key={idx} className="border-l-2 border-purple-600 pl-3" data-testid={`variation-budget-${idx}`}>
                                <div className="font-semibold">Replace: {swap.targetIngredient}</div>
                                <div className="text-sm">With: {swap.replacement}</div>
                                <div className="text-sm text-muted-foreground mt-1">{swap.reason}</div>
                                <div className="text-sm text-purple-600 font-medium mt-1">{swap.impactSummary}</div>
                              </div>
                            ))}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    )}
                  </Accordion>
                </CardContent>
              </Card>
              )
            )}

            {recipe.culturalSignificance && (
              <Card>
                <CardHeader className="gap-2">
                  <CardTitle className="font-serif text-2xl flex items-center gap-2">
                    <BookOpen className="h-6 w-6 text-primary" />
                    History & Cultural Significance
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="prose prose-sm dark:prose-invert max-w-none" data-testid="text-cultural-significance">
                    {recipe.culturalSignificance.split('\n\n').map((paragraph: string, idx: number) => (
                      <p key={idx} className="text-muted-foreground leading-relaxed mb-4 last:mb-0">
                        {paragraph}
                      </p>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {recipe.celebrityChefReviews && recipe.celebrityChefReviews.length > 0 && (
              <Card>
                <CardHeader className="gap-2">
                  <CardTitle className="font-serif text-2xl flex items-center gap-2">
                    <Star className="h-6 w-6 text-yellow-500" />
                    Celebrity Chef Reviews
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-6" data-testid="celebrity-chef-reviews">
                    {(recipe.celebrityChefReviews ?? []).map((review: any, idx: number) => {
                      const getChefStyle = (chefName: string) => {
                        switch (chefName) {
                          case 'Gordon Ramsay':
                            return {
                              borderColor: 'border-red-500',
                              bgColor: 'bg-red-50 dark:bg-red-950/20',
                              scoreColor: 'text-red-600 dark:text-red-400',
                              iconColor: 'text-red-500',
                              Icon: Flame
                            };
                          case 'Ina Garten':
                            return {
                              borderColor: 'border-blue-500',
                              bgColor: 'bg-blue-50 dark:bg-blue-950/20',
                              scoreColor: 'text-blue-600 dark:text-blue-400',
                              iconColor: 'text-blue-500',
                              Icon: Heart
                            };
                          case 'Matty Matheson':
                            return {
                              borderColor: 'border-orange-500',
                              bgColor: 'bg-orange-50 dark:bg-orange-950/20',
                              scoreColor: 'text-orange-600 dark:text-orange-400',
                              iconColor: 'text-orange-500',
                              Icon: Drumstick
                            };
                          default:
                            return {
                              borderColor: 'border-primary',
                              bgColor: 'bg-muted/50',
                              scoreColor: 'text-primary',
                              iconColor: 'text-primary',
                              Icon: ChefHat
                            };
                        }
                      };
                      const style = getChefStyle(review.chefName);
                      const IconComponent = style.Icon;
                      
                      return (
                        <div 
                          key={idx} 
                          className={`border-l-4 ${style.borderColor} ${style.bgColor} p-4`}
                          data-testid={`chef-review-${review.chefName?.toLowerCase().replace(/\s+/g, '-')}`}
                        >
                          <div className="flex items-start justify-between gap-4 mb-3">
                            <div className="flex items-center gap-2">
                              <IconComponent className={`h-6 w-6 ${style.iconColor}`} />
                              <div>
                                <div className="font-bold text-lg">{review.chefName}</div>
                                <div className="text-xs text-muted-foreground">{review.philosophy}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className={`text-3xl font-bold ${style.scoreColor}`}>{review.score}</span>
                              <span className="text-sm text-muted-foreground">/10</span>
                            </div>
                          </div>
                          <p className={`text-sm leading-relaxed ${review.chefName === 'Matty Matheson' ? 'font-bold' : ''}`}>
                            "{review.review}"
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {((recipe.allergens && recipe.allergens.length > 0) || (recipe.allergenFreeTags && recipe.allergenFreeTags.length > 0)) && (
              <Card>
                <CardHeader className="gap-2">
                  <CardTitle className="font-serif text-2xl">
                    Allergen Information
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Accordion type="single" collapsible>
                    {recipe.allergens && recipe.allergens.length > 0 && (
                      <AccordionItem value="allergens" className="border-0">
                        <AccordionTrigger className="py-2" data-testid="button-toggle-allergens">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 text-destructive" />
                            <span>Contains Allergens ({recipe.allergens.length})</span>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="flex flex-wrap gap-2 pt-2">
                            {(recipe.allergens ?? []).map((allergen: string) => (
                              <Badge
                                key={allergen}
                                variant="destructive"
                                data-testid={`badge-allergen-${allergen}`}
                              >
                                {allergen}
                              </Badge>
                            ))}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    )}
                    
                    {recipe.allergenFreeTags && recipe.allergenFreeTags.length > 0 && (
                      <AccordionItem value="allergen-free" className="border-0">
                        <AccordionTrigger className="py-2" data-testid="button-toggle-allergen-free">
                          <div className="flex items-center gap-2">
                            <Info className="h-4 w-4 text-blue-500 dark:text-blue-400" />
                            <span>Allergen-Free ({recipe.allergenFreeTags.length})</span>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="flex flex-wrap gap-2 pt-2">
                            {(recipe.allergenFreeTags ?? []).map((tag: string) => (
                              <Badge
                                key={tag}
                                variant="secondary"
                                data-testid={`badge-allergen-free-${tag}`}
                              >
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    )}
                  </Accordion>
                </CardContent>
              </Card>
            )}

            {activeDietaryFlags.length > 0 && (
              <Card>
                <CardHeader className="gap-2">
                  <CardTitle className="font-serif text-2xl">
                    Dietary Information
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Accordion type="single" collapsible>
                    <AccordionItem value="dietary" className="border-0">
                      <AccordionTrigger className="py-2" data-testid="button-toggle-dietary">
                        <div className="flex items-center gap-2">
                          <ChefHat className="h-4 w-4 text-primary" />
                          <span>Dietary Tags ({activeDietaryFlags.length})</span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="flex flex-wrap gap-2 pt-2">
                          {activeDietaryFlags.map((flag: string) => (
                            <Badge
                              key={flag}
                              variant="secondary"
                              data-testid={`badge-dietary-${flag}`}
                            >
                              {flag}
                            </Badge>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </CardContent>
              </Card>
            )}

            {(recipe.calories != null ||
              recipe.protein != null ||
              recipe.carbohydrates != null ||
              recipe.fat != null) && (
              <Card>
                <CardHeader className="gap-2">
                  <CardTitle className="font-serif text-2xl">
                    Nutrition Facts
                  </CardTitle>
                  <p className="text-sm text-muted-foreground" data-testid="text-serving-size">
                    {recipe.servingSize ? (
                      <>Per serving ({recipe.servingSize}){recipe.servings > 1 ? ` \u00B7 Makes ${recipe.servings} servings` : ''}</>
                    ) : (
                      <>Per serving{recipe.servings > 1 ? ` (makes ${recipe.servings} servings)` : ''}</>
                    )}
                  </p>
                </CardHeader>
                <CardContent>
                  <Accordion type="single" collapsible defaultValue="nutrition">
                    <AccordionItem value="nutrition" className="border-0">
                      <AccordionTrigger className="py-2" data-testid="button-toggle-nutrition">
                        <div className="flex items-center gap-2">
                          <Utensils className="h-4 w-4 text-primary" />
                          <span>Nutritional Information</span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="grid grid-cols-2 gap-3 pt-2">
                          {recipe.calories != null && (
                            <div className="flex flex-col items-center p-3 bg-muted rounded-md">
                              <div className="text-2xl font-bold text-primary">
                                {Math.round(recipe.calories)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Calories
                              </div>
                            </div>
                          )}
                          {recipe.protein != null && (
                            <div className="flex flex-col items-center p-3 bg-muted rounded-md">
                              <div className="text-2xl font-bold text-primary">
                                {recipe.protein.toFixed(1)}g
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Protein
                              </div>
                            </div>
                          )}
                          {recipe.carbohydrates != null && (
                            <div className="flex flex-col items-center p-3 bg-muted rounded-md">
                              <div className="text-2xl font-bold text-primary">
                                {recipe.carbohydrates.toFixed(1)}g
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Carbs
                              </div>
                            </div>
                          )}
                          {recipe.fat != null && (
                            <div className="flex flex-col items-center p-3 bg-muted rounded-md">
                              <div className="text-2xl font-bold text-primary">
                                {recipe.fat.toFixed(1)}g
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Fat
                              </div>
                            </div>
                          )}
                          {recipe.fiber != null && (
                            <div className="flex flex-col items-center p-3 bg-muted rounded-md">
                              <div className="text-2xl font-bold text-primary">
                                {recipe.fiber.toFixed(1)}g
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Fiber
                              </div>
                            </div>
                          )}
                          {recipe.sugar != null && (
                            <div className="flex flex-col items-center p-3 bg-muted rounded-md">
                              <div className="text-2xl font-bold text-primary">
                                {recipe.sugar.toFixed(1)}g
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Sugar
                              </div>
                            </div>
                          )}
                          {recipe.sodium != null && (
                            <div className="flex flex-col items-center p-3 bg-muted rounded-md">
                              <div className="text-2xl font-bold text-primary">
                                {Math.round(recipe.sodium)}mg
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Sodium
                              </div>
                            </div>
                          )}
                          {recipe.cholesterol != null && (
                            <div className="flex flex-col items-center p-3 bg-muted rounded-md">
                              <div className="text-2xl font-bold text-primary">
                                {Math.round(recipe.cholesterol)}mg
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Cholesterol
                              </div>
                            </div>
                          )}
                          {recipe.healthScore != null && (
                            <div className="col-span-2 flex flex-col items-center p-3 bg-muted rounded-md">
                              <div className="text-3xl font-bold text-primary">
                                {recipe.healthScore}/100
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Health Score
                              </div>
                            </div>
                          )}
                        </div>
                        {nutritionQualityTags.length > 0 && (
                          <div className="mt-4 pt-4 border-t">
                            <div className="text-xs text-muted-foreground mb-2">
                              Nutrition Highlights
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {nutritionQualityTags.map((tag: string) => (
                                <Badge
                                  key={tag}
                                  variant="secondary"
                                  className="text-xs"
                                  data-testid={`badge-nutrition-${tag}`}
                                >
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </CardContent>
              </Card>
            )}

            {recipe.equipment && recipe.equipment.length > 0 && (
              <Card>
                <CardHeader className="gap-2">
                  <CardTitle className="font-serif text-2xl flex items-center gap-2">
                    <Utensils className="h-5 w-5" />
                    Equipment
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {(recipe.equipment ?? []).map((item: string, idx: number) => (
                      <li
                        key={idx}
                        className="flex items-center gap-2 text-lg"
                        data-testid={`text-equipment-${idx}`}
                      >
                        <span className="text-xl">{getEquipmentEmoji(item)}</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

          {recipe.tips && recipe.tips.length > 0 && (
            <Card>
              <CardHeader className="gap-2">
                <CardTitle className="font-serif text-2xl flex items-center gap-2">
                  <Lightbulb className="h-5 w-5" />
                  Tips & Techniques
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Accordion type="multiple" className="w-full">
                  {Object.entries(tipsByType || {}).map(([type, tips]) => (
                    <AccordionItem key={type} value={type}>
                      <AccordionTrigger className="capitalize" data-testid={`button-toggle-tips-${type}`}>
                        {type.replace(/([A-Z])/g, ' $1').trim()} Tips
                      </AccordionTrigger>
                      <AccordionContent>
                        <ul className="space-y-2">
                          {(tips as any[]).map((tip: any, idx: number) => (
                            <li key={idx} className="flex gap-2" data-testid={`text-tip-${type}-${idx}`}>
                              <span className="text-primary mt-1.5">•</span>
                              <span>{tip.text}</span>
                            </li>
                          ))}
                        </ul>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </CardContent>
            </Card>
          )}

          {recipe.variations && recipe.variations.length > 0 && (
            <Card>
              <CardHeader className="gap-2">
                <CardTitle className="font-serif text-2xl flex items-center gap-2">
                  <Sparkles className="h-5 w-5" />
                  Variations
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {Object.entries(variationsByType || {}).map(([type, variations]) => (
                  <div key={type}>
                    <h4 className="font-semibold capitalize mb-3">{type} Variations</h4>
                    <div className="space-y-3">
                      {(variations as any[]).map((variation: any, idx: number) => (
                        <div key={idx} data-testid={`variation-${type}-${idx}`}>
                          <div className="font-medium">{variation.title}</div>
                          <div className="text-sm text-muted-foreground mt-1">
                            {variation.description}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {recipe.servingSuggestions && recipe.servingSuggestions.length > 0 && (
            <Card>
              <CardHeader className="gap-2">
                <CardTitle className="font-serif text-2xl">
                  Serving Suggestions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {(recipe.servingSuggestions ?? []).map((suggestion: string, idx: number) => (
                    <li
                      key={idx}
                      className="flex gap-2"
                      data-testid={`text-serving-suggestion-${idx}`}
                    >
                      <span className="text-primary mt-1.5">•</span>
                      <span className="text-lg">{suggestion}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {recipe.handwrittenImage && (
            <Card>
              <CardHeader className="gap-2">
                <CardTitle className="font-serif text-2xl">
                  Original Recipe
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className="relative rounded-lg overflow-hidden cursor-pointer hover-elevate active-elevate-2"
                  onClick={() => openImageModal(recipe.handwrittenImage!)}
                  data-testid="button-view-handwritten"
                >
                  <img
                    src={recipe.handwrittenImage}
                    alt="Handwritten recipe"
                    className="w-full h-auto"
                  />
                  <div className="absolute inset-0 bg-black/0 hover:bg-black/10 transition-colors flex items-center justify-center">
                    <ImageIcon className="h-12 w-12 text-white opacity-0 hover:opacity-100 transition-opacity" />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  Click to view full size
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog open={imageModalOpen} onOpenChange={setImageModalOpen}>
        <DialogContent className="max-w-4xl p-0">
          <img
            src={modalImage}
            alt="Full size"
            className="w-full h-auto"
            data-testid="img-modal-full-size"
          />
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      {/* Image Manager Dialog (triggered from dropdown menu) */}
      {showOwnerControls && (
        <RecipeImageManager
          recipeId={recipeId || ''}
          dishImages={recipe.dishImages || []}
          currentImage={recipe.dishImage || null}
          isOwner={isOwner}
          recipeName={recipe.title || ''}
          onImagesChange={() => {
            queryClient.invalidateQueries({ queryKey: ['/api/recipes', recipeId] });
          }}
          open={imageManagerOpen}
          onOpenChange={setImageManagerOpen}
          hideTrigger={true}
        />
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Recipe</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{recipe?.title}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground border border-destructive-border"
              onClick={(e) => {
                e.preventDefault();
                deleteMutation.mutate();
              }}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add to Cookbook dialog */}
      <AlertDialog open={addToCookbookOpen} onOpenChange={setAddToCookbookOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add to Cookbook</AlertDialogTitle>
            <AlertDialogDescription>
              Choose a cookbook to add this recipe to, or create a new one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <CookbookSelect
              value={selectedCookbookId}
              onValueChange={setSelectedCookbookId}
              placeholder="Select a cookbook"
              allowNone={false}
              testId="select-add-to-cookbook"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSelectedCookbookId(undefined)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (selectedCookbookId) {
                  addToCookbookMutation.mutate(selectedCookbookId);
                }
              }}
              disabled={!selectedCookbookId || addToCookbookMutation.isPending}
            >
              {addToCookbookMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                "Add to Cookbook"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Make Your Own modal */}
      {recipeId && recipe && (
        <MakeYourOwnModal
          open={makeYourOwnOpen}
          onOpenChange={setMakeYourOwnOpen}
          recipeId={recipeId}
          recipeTitle={recipe.title}
        />
      )}

      {/* Print-only view - hidden on screen, visible when printing */}
      <div className="hidden print:block print-recipe">
        {/* Recipe Title */}
        <div className="print-recipe-header">
          <h1 className="print-recipe-title">{recipe.title}</h1>
          {recipe.description && (
            <p className="print-recipe-description">{recipe.description}</p>
          )}
        </div>

        {/* Images side by side: dish image left, handwritten right */}
        <div className="print-recipe-images">
          {displayImage && !isPlaceholderImage(recipe.dishImage) && (
            <img
              src={displayImage}
              alt={recipe.title}
              className="print-recipe-dish-image"
            />
          )}
          {recipe.handwrittenImage && (
            <img
              src={recipe.handwrittenImage}
              alt="Original handwritten recipe"
              className="print-recipe-handwritten-image"
            />
          )}
        </div>

        {/* Recipe Quick Info - single line below images */}
        <div className="print-recipe-info">
          {recipe.prepTimeMinutes && (
            <span>Prep: {formatTime(recipe.prepTimeMinutes)}</span>
          )}
          {recipe.cookTimeMinutes && (
            <span>Cook: {formatTime(recipe.cookTimeMinutes)}</span>
          )}
          {recipe.totalTimeMinutes && (
            <span>Total: {formatTime(recipe.totalTimeMinutes)}</span>
          )}
          {recipe.servings && (
            <span>Serves: {recipe.servings}</span>
          )}
        </div>

        {/* Two-column layout for ingredients and instructions */}
        <div className="print-recipe-content">
          {/* Ingredients */}
          <div className="print-recipe-ingredients">
            <h2>Ingredients</h2>
            <ul>
              {displayIngredients.map((ing: any, idx: number) => {
                const quantityStr = formatQuantity(ing.quantity, ing.unit);
                return (
                  <li key={idx}>
                    {quantityStr && `${quantityStr} `}
                    {ing.item || ing.raw || ''}
                    {ing.preparation && `, ${ing.preparation}`}
                    {ing.isOptional && ' (optional)'}
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Instructions */}
          <div className="print-recipe-instructions">
            <h2>Instructions</h2>
            <ol>
              {displayInstructions.map((step: any, idx: number) => (
                <li key={idx}>
                  {typeof step === 'string' ? step : step.text}
                </li>
              ))}
            </ol>
          </div>
        </div>

      </div>
    </div>
  );
}

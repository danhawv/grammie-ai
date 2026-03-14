import { useMemo, useState, useRef } from "react";
import { useQuery, useMutation, useInfiniteQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, BookOpen, Clock, Users, Heart, HeartOff, Share2, Globe, Lock, Loader2, Printer, UserPlus, Image, Sparkles, Upload, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { CookbookCollaboratorsDialog } from "@/components/cookbook-collaborators-dialog";
import grammieImage from "@assets/image_1763329917086.png";

interface CookbookWithOwner {
  id: number;
  name: string;
  description: string | null;
  isPublic: boolean;
  ownerUserId: string;
  coverImage: string | null;
  owner?: {
    id: string;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    avatar: string | null;
  };
  recipeCount?: number;
}

interface RecipeCard {
  id: string;
  title: string;
  dishImageThumbnail: string | null;
  totalTimeMinutes: number | null;
  servings: number | null;
  cuisineType: string | null;
  difficulty: string | null;
}

interface CookbookRecipesResponse {
  recipes: RecipeCard[];
  hasMore: boolean;
  total: number;
}

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

export default function CookbookViewPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const cookbookId = parseInt(id || "0");
  const [collaboratorsOpen, setCollaboratorsOpen] = useState(false);

  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const [isGeneratingCover, setIsGeneratingCover] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleCoverUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploadingCover(true);
    try {
      const formData = new FormData();
      formData.append('image', file);

      const response = await fetch(`/api/cookbooks/${cookbookId}/cover-image`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to upload cover image');
      }

      queryClient.invalidateQueries({ queryKey: ['/api/cookbooks', cookbookId] });
      toast({
        title: "Cover image uploaded",
        description: "Your cookbook cover has been updated",
      });
    } catch (error) {
      toast({
        title: "Upload failed",
        description: "Failed to upload cover image",
        variant: "destructive",
      });
    } finally {
      setIsUploadingCover(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleGenerateCover = async () => {
    setIsGeneratingCover(true);
    try {
      await apiRequest('POST', `/api/cookbooks/${cookbookId}/generate-cover`);
      queryClient.invalidateQueries({ queryKey: ['/api/cookbooks', cookbookId] });
      toast({
        title: "Cover image generated",
        description: "AI has created a new cover for your cookbook",
      });
    } catch (error) {
      toast({
        title: "Generation failed",
        description: "Failed to generate cover image",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingCover(false);
    }
  };

  const handleDeleteCover = async () => {
    try {
      await apiRequest('DELETE', `/api/cookbooks/${cookbookId}/cover-image`);
      queryClient.invalidateQueries({ queryKey: ['/api/cookbooks', cookbookId] });
      toast({
        title: "Cover image removed",
      });
    } catch (error) {
      toast({
        title: "Failed to remove cover",
        variant: "destructive",
      });
    }
  };

  const { data: cookbook, isLoading: cookbookLoading, error: cookbookError } = useQuery<CookbookWithOwner>({
    queryKey: ['/api/cookbooks', cookbookId],
    queryFn: async () => {
      const response = await fetch(`/api/cookbooks/${cookbookId}`, {
        credentials: 'include',
      });
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Cookbook not found');
        }
        if (response.status === 403) {
          throw new Error('This cookbook is private');
        }
        throw new Error('Failed to load cookbook');
      }
      return response.json();
    },
    enabled: cookbookId > 0,
  });

  const { 
    data: recipesData, 
    isLoading: recipesLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<CookbookRecipesResponse>({
    queryKey: ['/api/cookbooks', cookbookId, 'recipes'],
    queryFn: async ({ pageParam = 1 }) => {
      const response = await fetch(`/api/cookbooks/${cookbookId}/recipes?page=${pageParam}&limit=24`, {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to load recipes');
      }
      return response.json();
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, pages) => {
      return lastPage.hasMore ? pages.length + 1 : undefined;
    },
    enabled: cookbookId > 0 && !!cookbook,
    placeholderData: (previousData) => previousData,
  });

  const recipes = useMemo(() => {
    return recipesData?.pages.flatMap(page => page.recipes) || [];
  }, [recipesData]);
  
  const totalRecipes = recipesData?.pages[0]?.total || 0;

  const { data: followedCookbookIds = [] } = useQuery<number[]>({
    queryKey: ['/api/cookbooks/following/ids'],
    enabled: !!user,
  });

  const isFollowing = followedCookbookIds.includes(cookbookId);
  const isOwner = user?.id === cookbook?.ownerUserId;

  const followMutation = useMutation({
    mutationFn: async () => {
      if (isFollowing) {
        await apiRequest("DELETE", `/api/cookbooks/${cookbookId}/follow`);
      } else {
        await apiRequest("POST", `/api/cookbooks/${cookbookId}/follow`);
      }
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['/api/cookbooks/following/ids'] });
      const previousFollowing = queryClient.getQueryData<number[]>(['/api/cookbooks/following/ids']);
      
      queryClient.setQueryData<number[]>(['/api/cookbooks/following/ids'], (old = []) => {
        if (isFollowing) {
          return old.filter(id => id !== cookbookId);
        } else {
          return [...old, cookbookId];
        }
      });
      
      return { previousFollowing };
    },
    onError: (error, variables, context) => {
      if (context?.previousFollowing) {
        queryClient.setQueryData(['/api/cookbooks/following/ids'], context.previousFollowing);
      }
      toast({
        title: "Failed to update follow status",
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/cookbooks/following/ids'] });
    },
  });

  const handleShare = async () => {
    const url = `${window.location.origin}/cookbook/${cookbookId}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({
        title: "Link copied!",
        description: "Cookbook link has been copied to your clipboard",
      });
    } catch (error) {
      toast({
        title: "Failed to copy link",
        variant: "destructive",
      });
    }
  };

  const handleFollow = () => {
    if (!user) {
      toast({
        title: "Sign in required",
        description: "Please sign in to follow cookbooks",
      });
      return;
    }
    followMutation.mutate();
  };

  if (cookbookLoading) {
    return (
      <div className="container max-w-4xl mx-auto py-8 px-4">
        <Skeleton className="h-8 w-32 mb-6" />
        <Card>
          <CardContent className="py-8">
            <div className="flex items-center gap-4 mb-6">
              <Skeleton className="h-16 w-16 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-4 w-40" />
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <Skeleton key={i} className="aspect-square rounded-lg" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (cookbookError || !cookbook) {
    const errorMessage = cookbookError instanceof Error ? cookbookError.message : 'Cookbook not found';
    return (
      <div className="container max-w-2xl mx-auto py-8 px-4">
        <Card>
          <CardContent className="py-12 text-center">
            <BookOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">Cookbook Not Available</h2>
            <p className="text-muted-foreground mb-6">
              {errorMessage}
            </p>
            <Link href="/">
              <Button variant="outline" data-testid="button-back-home">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Recipes
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const ownerName = cookbook.owner?.username || 
    [cookbook.owner?.firstName, cookbook.owner?.lastName].filter(Boolean).join(' ') ||
    'Unknown';
  
  const ownerInitials = cookbook.owner?.username?.slice(0, 2).toUpperCase() ||
    [cookbook.owner?.firstName?.[0], cookbook.owner?.lastName?.[0]].filter(Boolean).join('').toUpperCase() ||
    '?';

  return (
    <div className="container max-w-4xl mx-auto py-8 px-4">
      <div className="mb-6">
        <Link href="/">
          <Button variant="ghost" size="sm" className="touch-target" data-testid="button-back-home">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Recipes
          </Button>
        </Link>
      </div>

      <Card className="mb-6">
        <CardContent className="py-6">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleCoverUpload}
                accept="image/*"
                className="hidden"
                data-testid="input-cover-upload"
              />
              {isOwner ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <div className="h-16 w-16 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 cursor-pointer hover-elevate relative group" data-testid="button-cover-menu">
                      {cookbook.coverImage ? (
                        <img
                          src={cookbook.coverImage}
                          alt={`${cookbook.name} cover`}
                          className="h-full w-full object-cover rounded-lg"
                        />
                      ) : (
                        <BookOpen className="h-8 w-8 text-primary" />
                      )}
                      {(isUploadingCover || isGeneratingCover) && (
                        <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center">
                          <Loader2 className="h-6 w-6 animate-spin text-white" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/30 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Image className="h-5 w-5 text-white" />
                      </div>
                    </div>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem 
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploadingCover || isGeneratingCover}
                      data-testid="menu-upload-cover"
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Upload Image
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={handleGenerateCover}
                      disabled={isUploadingCover || isGeneratingCover}
                      data-testid="menu-generate-cover"
                    >
                      <Sparkles className="h-4 w-4 mr-2" />
                      Generate with AI
                    </DropdownMenuItem>
                    {cookbook.coverImage && (
                      <DropdownMenuItem 
                        onClick={handleDeleteCover}
                        className="text-destructive"
                        data-testid="menu-remove-cover"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Remove Cover
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <div className="h-16 w-16 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {cookbook.coverImage ? (
                    <img
                      src={cookbook.coverImage}
                      alt={`${cookbook.name} cover`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <BookOpen className="h-8 w-8 text-primary" />
                  )}
                </div>
              )}
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-bold" data-testid="text-cookbook-name">
                    {cookbook.name}
                  </h1>
                  <Badge variant={cookbook.isPublic ? "secondary" : "outline"} className="text-xs">
                    {cookbook.isPublic ? (
                      <><Globe className="h-3 w-3 mr-1" /> Public</>
                    ) : (
                      <><Lock className="h-3 w-3 mr-1" /> Private</>
                    )}
                  </Badge>
                </div>
                {cookbook.description && (
                  <p className="text-muted-foreground mt-1" data-testid="text-cookbook-description">
                    {cookbook.description}
                  </p>
                )}
                <div className="flex items-center gap-4 mt-3">
                  <Link href={`/profile/${cookbook.ownerUserId}`}>
                    <div className="flex items-center gap-2 hover-elevate rounded-md px-2 py-1 -mx-2 cursor-pointer" data-testid="link-cookbook-owner">
                      <Avatar className="h-6 w-6">
                        <AvatarImage src={cookbook.owner?.avatar || undefined} />
                        <AvatarFallback className="text-xs">{ownerInitials}</AvatarFallback>
                      </Avatar>
                      <span className="text-sm text-muted-foreground">by {ownerName}</span>
                    </div>
                  </Link>
                  <span className="text-sm text-muted-foreground">
                    {totalRecipes} recipe{totalRecipes !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-2 flex-wrap">
              {isOwner && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCollaboratorsOpen(true)}
                    data-testid="button-manage-collaborators"
                  >
                    <UserPlus className="h-4 w-4 mr-2" />
                    Collaborators
                  </Button>
                  <Link href={`/cookbook/${cookbookId}/print`}>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="button-print-cookbook"
                    >
                      <Printer className="h-4 w-4 mr-2" />
                      Print
                    </Button>
                  </Link>
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleShare}
                data-testid="button-share-cookbook"
              >
                <Share2 className="h-4 w-4 mr-2" />
                Share
              </Button>
              {!isOwner && cookbook.isPublic && (
                <Button
                  variant={isFollowing ? "secondary" : "default"}
                  size="sm"
                  onClick={handleFollow}
                  disabled={followMutation.isPending}
                  data-testid="button-follow-cookbook"
                >
                  {isFollowing ? (
                    <><HeartOff className="h-4 w-4 mr-2" /> Unfollow</>
                  ) : (
                    <><Heart className="h-4 w-4 mr-2" /> Follow</>
                  )}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {recipesLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <Skeleton key={i} className="aspect-square rounded-lg" />
          ))}
        </div>
      ) : recipes.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BookOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">This cookbook doesn't have any recipes yet.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {recipes.map((recipe) => (
              <Link key={recipe.id} href={`/recipe/${recipe.id}`}>
                <Card className="overflow-hidden hover-elevate cursor-pointer h-full" data-testid={`card-recipe-${recipe.id}`}>
                  <div className="aspect-square relative bg-muted">
                    {recipe.dishImageThumbnail && !recipe.dishImageThumbnail.startsWith('data:image/svg') ? (
                      <img
                        src={recipe.dishImageThumbnail}
                        alt={recipe.title}
                        loading="lazy"
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <img src={grammieImage} alt="Grammie" className="h-16 w-16 object-contain opacity-50" />
                      </div>
                    )}
                  </div>
                  <CardContent className="p-3">
                    <h3 className="font-medium text-sm line-clamp-2" data-testid={`text-recipe-title-${recipe.id}`}>
                      {recipe.title}
                    </h3>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      {recipe.totalTimeMinutes && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatTime(recipe.totalTimeMinutes)}
                        </span>
                      )}
                      {recipe.servings && (
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {recipe.servings}
                        </span>
                      )}
                    </div>
                    {recipe.cuisineType && (
                      <Badge variant="secondary" className="mt-2 text-xs">
                        {recipe.cuisineType}
                      </Badge>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
          {hasNextPage && (
            <div className="flex justify-center mt-6">
              <Button
                variant="outline"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                data-testid="button-load-more-recipes"
              >
                {isFetchingNextPage ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading...</>
                ) : (
                  `Load More (${recipes.length} of ${totalRecipes})`
                )}
              </Button>
            </div>
          )}
        </>
      )}

      <CookbookCollaboratorsDialog
        cookbookId={cookbookId}
        cookbookName={cookbook.name}
        isOwner={isOwner}
        open={collaboratorsOpen}
        onOpenChange={setCollaboratorsOpen}
      />
    </div>
  );
}

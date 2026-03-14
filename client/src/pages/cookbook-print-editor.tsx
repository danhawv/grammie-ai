import { useState, useMemo, useCallback, useEffect, useRef, Component, ErrorInfo, ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link, useLocation } from "wouter";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ArrowLeft,
  BookOpen,
  GripVertical,
  Plus,
  Trash2,
  Edit,
  Save,
  Eye,
  ChevronDown,
  ChevronRight,
  FileText,
  Image,
  Loader2,
  AlertCircle,
  Check,
  Download,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { CookbookPrintPreview } from "@/components/cookbook-print-preview";
import { PreflightCheckPanel } from "@/components/preflight-check-panel";
import { PrintOrderPanel } from "@/components/print-order-panel";
import type { PrintLayoutData, CookbookPrintProject } from "@shared/schema";

interface CookbookWithOwner {
  id: number;
  name: string;
  description: string | null;
  isPublic: boolean;
  ownerUserId: string;
}

interface RecipeCard {
  id: string;
  title: string;
  dishImageThumbnail: string | null;
}

interface Section {
  id: string;
  title: string;
  recipeIds: string[];
}

const TEMPLATE_STYLES = [
  { id: "classic", name: "Classic", description: "Traditional cookbook layout with elegant typography" },
  { id: "modern", name: "Modern", description: "Clean, minimalist design with bold imagery" },
  { id: "rustic", name: "Rustic", description: "Warm, homey feel with textured backgrounds" },
  { id: "minimalist", name: "Minimalist", description: "Simple, uncluttered design focused on content" },
] as const;

const PAGE_SIZES = [
  { id: "6x9", name: '6" x 9"', description: "Standard paperback" },
  { id: "8.5x11", name: '8.5" x 11"', description: "Letter size" },
  { id: "a4", name: "A4", description: "International standard" },
] as const;

class PrintEditorErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[PrintEditorErrorBoundary] Caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="container max-w-2xl mx-auto py-8 px-4">
          <Card>
            <CardContent className="py-12 text-center">
              <AlertCircle className="h-12 w-12 mx-auto text-destructive mb-4" />
              <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
              <p className="text-muted-foreground mb-4">
                There was an error loading the print editor.
              </p>
              <pre className="text-left bg-muted p-4 rounded text-xs overflow-auto max-h-48 mb-4">
                {this.state.error?.message}
                {'\n\n'}
                {this.state.error?.stack}
              </pre>
              <Link href="/">
                <Button variant="outline">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Home
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}

function SortableRecipeItem({ 
  recipe, 
  onRemove 
}: { 
  recipe: RecipeCard; 
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: recipe.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 p-3 bg-background border rounded-md group"
      data-testid={`sortable-recipe-${recipe.id}`}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none p-1 hover-elevate rounded"
        data-testid={`drag-handle-${recipe.id}`}
      >
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </button>
      {recipe.dishImageThumbnail ? (
        <img
          src={recipe.dishImageThumbnail}
          alt={recipe.title}
          className="w-12 h-12 rounded object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-12 h-12 rounded bg-muted flex items-center justify-center flex-shrink-0">
          <BookOpen className="h-5 w-5 text-muted-foreground" />
        </div>
      )}
      <span className="flex-1 text-sm font-medium truncate">{recipe.title}</span>
      <Button
        variant="ghost"
        size="icon"
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 transition-opacity"
        data-testid={`remove-recipe-${recipe.id}`}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}

function SectionEditor({
  section,
  recipes,
  allRecipes,
  onUpdateTitle,
  onRemoveSection,
  onRemoveRecipe,
  onAddRecipes,
  isExpanded,
  onToggleExpand,
}: {
  section: Section;
  recipes: RecipeCard[];
  allRecipes: RecipeCard[];
  onUpdateTitle: (title: string) => void;
  onRemoveSection: () => void;
  onRemoveRecipe: (recipeId: string) => void;
  onAddRecipes: (recipeIds: string[]) => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(section.title);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedRecipes, setSelectedRecipes] = useState<string[]>([]);

  const availableRecipes = useMemo(() => {
    const usedIds = new Set(section.recipeIds);
    return allRecipes.filter(r => !usedIds.has(r.id));
  }, [allRecipes, section.recipeIds]);

  const handleSaveTitle = () => {
    onUpdateTitle(editTitle);
    setIsEditing(false);
  };

  const handleAddRecipes = () => {
    if (selectedRecipes.length > 0) {
      onAddRecipes(selectedRecipes);
      setSelectedRecipes([]);
      setShowAddDialog(false);
    }
  };

  return (
    <Card className="mb-4" data-testid={`section-${section.id}`}>
      <Collapsible open={isExpanded} onOpenChange={onToggleExpand}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover-elevate py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 flex-shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 flex-shrink-0" />
                )}
                {isEditing ? (
                  <div className="flex items-center gap-2 flex-1" onClick={e => e.stopPropagation()}>
                    <Input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="h-8"
                      data-testid={`input-section-title-${section.id}`}
                    />
                    <Button size="icon" variant="ghost" onClick={handleSaveTitle} data-testid={`save-section-title-${section.id}`}>
                      <Check className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <CardTitle className="text-base truncate">{section.title}</CardTitle>
                    <Badge variant="secondary" className="text-xs flex-shrink-0">
                      {recipes.length} recipe{recipes.length !== 1 ? "s" : ""}
                    </Badge>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                {!isEditing && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setEditTitle(section.title);
                      setIsEditing(true);
                    }}
                    data-testid={`edit-section-${section.id}`}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onRemoveSection}
                  data-testid={`remove-section-${section.id}`}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">
            <SortableContext items={section.recipeIds} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {recipes.map((recipe) => (
                  <SortableRecipeItem
                    key={recipe.id}
                    recipe={recipe}
                    onRemove={() => onRemoveRecipe(recipe.id)}
                  />
                ))}
              </div>
            </SortableContext>
            
            {recipes.length === 0 && (
              <div className="text-center py-6 text-muted-foreground">
                <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No recipes in this section</p>
              </div>
            )}

            <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
              <DialogTrigger asChild>
                <Button variant="outline" className="w-full mt-4" data-testid={`add-recipes-${section.id}`}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Recipes
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Add Recipes to {section.title}</DialogTitle>
                  <DialogDescription>
                    Select recipes to add to this section.
                  </DialogDescription>
                </DialogHeader>
                <ScrollArea className="h-[300px] pr-4">
                  <div className="space-y-2">
                    {availableRecipes.length === 0 ? (
                      <p className="text-center text-muted-foreground py-8">
                        All recipes are already in this section.
                      </p>
                    ) : (
                      availableRecipes.map((recipe) => (
                        <div
                          key={recipe.id}
                          className={`flex items-center gap-3 p-3 border rounded-md cursor-pointer transition-colors ${
                            selectedRecipes.includes(recipe.id)
                              ? "border-primary bg-primary/5"
                              : "hover-elevate"
                          }`}
                          onClick={() => {
                            setSelectedRecipes(prev =>
                              prev.includes(recipe.id)
                                ? prev.filter(id => id !== recipe.id)
                                : [...prev, recipe.id]
                            );
                          }}
                          data-testid={`select-recipe-${recipe.id}`}
                        >
                          {recipe.dishImageThumbnail ? (
                            <img
                              src={recipe.dishImageThumbnail}
                              alt={recipe.title}
                              className="w-10 h-10 rounded object-cover"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded bg-muted flex items-center justify-center">
                              <BookOpen className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )}
                          <span className="flex-1 text-sm font-medium truncate">{recipe.title}</span>
                          {selectedRecipes.includes(recipe.id) && (
                            <Check className="h-4 w-4 text-primary" />
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleAddRecipes}
                    disabled={selectedRecipes.length === 0}
                    data-testid="confirm-add-recipes"
                  >
                    Add {selectedRecipes.length} Recipe{selectedRecipes.length !== 1 ? "s" : ""}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function RecipeOverlay({ recipe }: { recipe: RecipeCard | null }) {
  if (!recipe) return null;

  return (
    <div className="flex items-center gap-3 p-3 bg-background border rounded-md shadow-lg">
      <GripVertical className="h-4 w-4 text-muted-foreground" />
      {recipe.dishImageThumbnail ? (
        <img
          src={recipe.dishImageThumbnail}
          alt={recipe.title}
          className="w-12 h-12 rounded object-cover"
        />
      ) : (
        <div className="w-12 h-12 rounded bg-muted flex items-center justify-center">
          <BookOpen className="h-5 w-5 text-muted-foreground" />
        </div>
      )}
      <span className="text-sm font-medium">{recipe.title}</span>
    </div>
  );
}

function CookbookPrintEditorInner() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { user, isLoading: userLoading } = useAuth();
  const { toast } = useToast();
  const cookbookId = parseInt(id || "0");

  const [layoutData, setLayoutData] = useState<PrintLayoutData>({
    sections: [],
  });
  const [templateStyle, setTemplateStyle] = useState<'classic' | 'modern' | 'rustic' | 'minimalist'>('classic');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [activeRecipe, setActiveRecipe] = useState<RecipeCard | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showNewSectionDialog, setShowNewSectionDialog] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const isInitialized = useRef(false);

  const handleDownloadPdf = async () => {
    if (!cookbookId) return;
    setIsGeneratingPdf(true);
    try {
      const response = await fetch(`/api/cookbooks/${cookbookId}/generate-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          layoutData,
          templateStyle,
        }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to generate PDF');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(layoutData.title || 'cookbook').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      toast({ title: "PDF Generated", description: "Your cookbook PDF has been downloaded." });
    } catch (error) {
      console.error('PDF generation error:', error);
      toast({ 
        title: "PDF Generation Failed", 
        description: error instanceof Error ? error.message : "Could not generate PDF",
        variant: "destructive"
      });
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Fetch cookbook
  const { data: cookbook, isLoading: cookbookLoading, error: cookbookError } = useQuery<CookbookWithOwner>({
    queryKey: ['/api/cookbooks', cookbookId],
    queryFn: async () => {
      const response = await fetch(`/api/cookbooks/${cookbookId}`);
      if (!response.ok) throw new Error('Failed to load cookbook');
      return response.json();
    },
    enabled: cookbookId > 0,
  });

  // Fetch cookbook recipes
  const { data: recipesData, isLoading: recipesLoading } = useQuery<{ recipes: RecipeCard[] }>({
    queryKey: ['/api/cookbooks', cookbookId, 'recipes', 'all'],
    queryFn: async () => {
      const response = await fetch(`/api/cookbooks/${cookbookId}/recipes?limit=500`);
      if (!response.ok) throw new Error('Failed to load recipes');
      return response.json();
    },
    enabled: cookbookId > 0 && !!cookbook,
  });

  const allRecipes = useMemo(() => recipesData?.recipes || [], [recipesData?.recipes]);
  const recipesById = useMemo(() => {
    const map = new Map<string, RecipeCard>();
    allRecipes.forEach(r => map.set(r.id, r));
    return map;
  }, [allRecipes]);

  // Fetch or create print project
  const { data: printProjects, isLoading: projectsLoading } = useQuery<CookbookPrintProject[]>({
    queryKey: ['/api/cookbooks', cookbookId, 'print-projects'],
    enabled: cookbookId > 0 && !!cookbook,
  });

  const currentProject = printProjects?.[0];

  // Initialize layout from existing project or create default
  const initializeLayout = useCallback(() => {
    if (isInitialized.current) return;
    
    if (currentProject && currentProject.layoutData && currentProject.layoutData.sections) {
      setLayoutData(currentProject.layoutData);
      setTemplateStyle(currentProject.templateStyle);
      isInitialized.current = true;
    } else if (allRecipes.length > 0) {
      // Create default layout with all recipes in one section
      setLayoutData({
        sections: [{
          id: crypto.randomUUID(),
          title: cookbook?.name || "All Recipes",
          recipeIds: allRecipes.map(r => r.id),
        }],
        title: cookbook?.name,
        authorName: user?.firstName && user?.lastName 
          ? `${user.firstName} ${user.lastName}` 
          : user?.username || undefined,
      });
      setHasUnsavedChanges(true);
      isInitialized.current = true;
    }
  }, [currentProject, allRecipes, cookbook, user]);

  // Initialize on data load
  useEffect(() => {
    if (!recipesLoading && !projectsLoading) {
      initializeLayout();
    }
  }, [recipesLoading, projectsLoading, initializeLayout]);

  // Create print project mutation
  const createProjectMutation = useMutation({
    mutationFn: async (data: { layoutData: PrintLayoutData; templateStyle: string }) => {
      return apiRequest("POST", `/api/cookbooks/${cookbookId}/print-projects`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/cookbooks', cookbookId, 'print-projects'] });
      setHasUnsavedChanges(false);
      toast({ title: "Project created", description: "Your print project has been created." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create project.", variant: "destructive" });
    },
  });

  // Update print project mutation
  const updateProjectMutation = useMutation({
    mutationFn: async (data: { layoutData: PrintLayoutData; templateStyle: string }) => {
      return apiRequest("PATCH", `/api/print-projects/${currentProject!.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/cookbooks', cookbookId, 'print-projects'] });
      setHasUnsavedChanges(false);
      toast({ title: "Saved", description: "Your changes have been saved." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save changes.", variant: "destructive" });
    },
  });

  const handleSave = () => {
    const data = { layoutData, templateStyle };
    if (currentProject) {
      updateProjectMutation.mutate(data);
    } else {
      createProjectMutation.mutate(data);
    }
  };

  const isSaving = createProjectMutation.isPending || updateProjectMutation.isPending;

  // Section management
  const handleAddSection = () => {
    if (!newSectionTitle.trim()) return;
    
    const newSection: Section = {
      id: crypto.randomUUID(),
      title: newSectionTitle.trim(),
      recipeIds: [],
    };
    
    setLayoutData(prev => ({
      ...prev,
      sections: [...prev.sections, newSection],
    }));
    setExpandedSections(prev => new Set([...Array.from(prev), newSection.id]));
    setNewSectionTitle("");
    setShowNewSectionDialog(false);
    setHasUnsavedChanges(true);
  };

  const handleRemoveSection = (sectionId: string) => {
    setLayoutData(prev => ({
      ...prev,
      sections: prev.sections.filter(s => s.id !== sectionId),
    }));
    setHasUnsavedChanges(true);
  };

  const handleUpdateSectionTitle = (sectionId: string, title: string) => {
    setLayoutData(prev => ({
      ...prev,
      sections: prev.sections.map(s =>
        s.id === sectionId ? { ...s, title } : s
      ),
    }));
    setHasUnsavedChanges(true);
  };

  const handleRemoveRecipe = (sectionId: string, recipeId: string) => {
    setLayoutData(prev => ({
      ...prev,
      sections: prev.sections.map(s =>
        s.id === sectionId
          ? { ...s, recipeIds: s.recipeIds.filter(id => id !== recipeId) }
          : s
      ),
    }));
    setHasUnsavedChanges(true);
  };

  const handleAddRecipes = (sectionId: string, recipeIds: string[]) => {
    setLayoutData(prev => ({
      ...prev,
      sections: prev.sections.map(s =>
        s.id === sectionId
          ? { ...s, recipeIds: [...s.recipeIds, ...recipeIds] }
          : s
      ),
    }));
    setHasUnsavedChanges(true);
  };

  // Drag and drop handlers
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const recipe = recipesById.get(active.id as string);
    setActiveRecipe(recipe || null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveRecipe(null);

    if (!over || active.id === over.id) return;

    // Find which section contains the active item
    let activeSectionIndex = -1;
    let activeIndex = -1;
    let overSectionIndex = -1;
    let overIndex = -1;

    (layoutData?.sections || []).forEach((section, sIdx) => {
      const aIdx = section.recipeIds.indexOf(active.id as string);
      const oIdx = section.recipeIds.indexOf(over.id as string);
      if (aIdx !== -1) {
        activeSectionIndex = sIdx;
        activeIndex = aIdx;
      }
      if (oIdx !== -1) {
        overSectionIndex = sIdx;
        overIndex = oIdx;
      }
    });

    if (activeSectionIndex === -1) return;

    // Same section reorder
    if (activeSectionIndex === overSectionIndex && overIndex !== -1) {
      setLayoutData(prev => ({
        ...prev,
        sections: prev.sections.map((s, idx) =>
          idx === activeSectionIndex
            ? { ...s, recipeIds: arrayMove(s.recipeIds, activeIndex, overIndex) }
            : s
        ),
      }));
      setHasUnsavedChanges(true);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    // Could implement cross-section drag here if needed
  };

  // Cover details handlers
  const updateLayoutField = (field: keyof PrintLayoutData, value: any) => {
    setLayoutData(prev => ({ ...prev, [field]: value }));
    setHasUnsavedChanges(true);
  };

  const updateCustomization = (field: string, value: any) => {
    setLayoutData(prev => ({
      ...prev,
      customizations: {
        showNutrition: prev.customizations?.showNutrition ?? true,
        showPageNumbers: prev.customizations?.showPageNumbers ?? true,
        pageSize: prev.customizations?.pageSize ?? '6x9',
        ...prev.customizations,
        [field]: value,
      },
    }));
    setHasUnsavedChanges(true);
  };

  // Calculate estimated page count
  const estimatedPageCount = useMemo(() => {
    const sections = layoutData?.sections || [];
    const totalRecipes = sections.reduce((sum, s) => sum + s.recipeIds.length, 0);
    // Rough estimate: 2 pages per recipe + front matter + section dividers
    return Math.ceil(totalRecipes * 2 + sections.length + 4);
  }, [layoutData?.sections]);

  // Check authorization
  const isOwner = user?.id === cookbook?.ownerUserId;

  if (cookbookLoading || recipesLoading || projectsLoading || userLoading) {
    return (
      <div className="container max-w-6xl mx-auto py-8 px-4">
        <Skeleton className="h-8 w-48 mb-6" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <Skeleton className="h-[400px] rounded-lg" />
          </div>
          <div>
            <Skeleton className="h-[300px] rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  if (cookbookError || !cookbook) {
    return (
      <div className="container max-w-2xl mx-auto py-8 px-4">
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="h-12 w-12 mx-auto text-destructive mb-4" />
            <h2 className="text-xl font-semibold mb-2">Cookbook Not Found</h2>
            <p className="text-muted-foreground mb-6">
              The cookbook you're looking for doesn't exist or you don't have access to it.
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

  if (!isOwner) {
    return (
      <div className="container max-w-2xl mx-auto py-8 px-4">
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="h-12 w-12 mx-auto text-destructive mb-4" />
            <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
            <p className="text-muted-foreground mb-6">
              Only the cookbook owner can create print projects.
            </p>
            <Link href={`/cookbook/${cookbookId}`}>
              <Button variant="outline" data-testid="button-back-cookbook">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Cookbook
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-6xl mx-auto py-6 px-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <Link href={`/cookbook/${cookbookId}`}>
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Print Cookbook</h1>
            <p className="text-muted-foreground text-sm">{cookbook.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasUnsavedChanges && (
            <Badge variant="secondary" className="text-xs">
              Unsaved changes
            </Badge>
          )}
          <Button
            onClick={handleSave}
            disabled={isSaving || !hasUnsavedChanges}
            data-testid="button-save"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save
          </Button>
          <Button 
            variant="outline" 
            onClick={() => setShowPreview(true)}
            disabled={!layoutData?.sections?.length || layoutData.sections.every(s => s.recipeIds.length === 0)}
            data-testid="button-preview"
          >
            <Eye className="h-4 w-4 mr-2" />
            Preview
          </Button>
          <Button 
            onClick={handleDownloadPdf}
            disabled={isGeneratingPdf || !layoutData?.sections?.length || layoutData.sections.every(s => s.recipeIds.length === 0)}
            data-testid="button-download-pdf"
          >
            {isGeneratingPdf ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            {isGeneratingPdf ? "Generating..." : "Download PDF"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Editor */}
        <div className="lg:col-span-2 space-y-6">
          {/* Cover Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Cover Details</CardTitle>
              <CardDescription>Customize the title page of your cookbook</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="title">Title</Label>
                  <Input
                    id="title"
                    placeholder="My Cookbook"
                    value={layoutData.title || ""}
                    onChange={(e) => updateLayoutField("title", e.target.value)}
                    data-testid="input-title"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="subtitle">Subtitle</Label>
                  <Input
                    id="subtitle"
                    placeholder="A collection of family recipes"
                    value={layoutData.subtitle || ""}
                    onChange={(e) => updateLayoutField("subtitle", e.target.value)}
                    data-testid="input-subtitle"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="author">Author Name</Label>
                <Input
                  id="author"
                  placeholder="Your name"
                  value={layoutData.authorName || ""}
                  onChange={(e) => updateLayoutField("authorName", e.target.value)}
                  data-testid="input-author"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dedication">Dedication (Optional)</Label>
                <Textarea
                  id="dedication"
                  placeholder="For my grandmother, who taught me to love cooking..."
                  value={layoutData.dedication || ""}
                  onChange={(e) => updateLayoutField("dedication", e.target.value)}
                  className="resize-none"
                  rows={3}
                  data-testid="input-dedication"
                />
              </div>
            </CardContent>
          </Card>

          {/* Sections & Recipes */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-lg">Sections & Recipes</CardTitle>
                  <CardDescription>
                    Organize your cookbook into sections. Drag to reorder recipes.
                  </CardDescription>
                </div>
                <Dialog open={showNewSectionDialog} onOpenChange={setShowNewSectionDialog}>
                  <DialogTrigger asChild>
                    <Button size="sm" data-testid="button-add-section">
                      <Plus className="h-4 w-4 mr-2" />
                      Add Section
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add New Section</DialogTitle>
                      <DialogDescription>
                        Create a new section to organize your recipes.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="section-title">Section Title</Label>
                        <Input
                          id="section-title"
                          placeholder="e.g., Appetizers, Main Courses, Desserts"
                          value={newSectionTitle}
                          onChange={(e) => setNewSectionTitle(e.target.value)}
                          data-testid="input-new-section-title"
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setShowNewSectionDialog(false)}>
                        Cancel
                      </Button>
                      <Button
                        onClick={handleAddSection}
                        disabled={!newSectionTitle.trim()}
                        data-testid="confirm-add-section"
                      >
                        Add Section
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver}
              >
                {(!layoutData?.sections || layoutData.sections.length === 0) ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <BookOpen className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p className="font-medium">No sections yet</p>
                    <p className="text-sm">Add a section to start organizing your cookbook.</p>
                  </div>
                ) : (
                  layoutData.sections.map((section) => (
                    <SectionEditor
                      key={section.id}
                      section={section}
                      recipes={section.recipeIds
                        .map(id => recipesById.get(id))
                        .filter((r): r is RecipeCard => !!r)}
                      allRecipes={allRecipes}
                      onUpdateTitle={(title) => handleUpdateSectionTitle(section.id, title)}
                      onRemoveSection={() => handleRemoveSection(section.id)}
                      onRemoveRecipe={(recipeId) => handleRemoveRecipe(section.id, recipeId)}
                      onAddRecipes={(recipeIds) => handleAddRecipes(section.id, recipeIds)}
                      isExpanded={expandedSections.has(section.id)}
                      onToggleExpand={() => {
                        setExpandedSections(prev => {
                          const next = new Set(prev);
                          if (next.has(section.id)) {
                            next.delete(section.id);
                          } else {
                            next.add(section.id);
                          }
                          return next;
                        });
                      }}
                    />
                  ))
                )}
                <DragOverlay>
                  <RecipeOverlay recipe={activeRecipe} />
                </DragOverlay>
              </DndContext>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar - Settings & Preview */}
        <div className="space-y-6">
          {/* Template Style */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Template Style</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {TEMPLATE_STYLES.map((style) => (
                <div
                  key={style.id}
                  className={`p-3 border rounded-md cursor-pointer transition-colors ${
                    templateStyle === style.id
                      ? "border-primary bg-primary/5"
                      : "hover-elevate"
                  }`}
                  onClick={() => {
                    setTemplateStyle(style.id);
                    setHasUnsavedChanges(true);
                  }}
                  data-testid={`template-${style.id}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{style.name}</span>
                    {templateStyle === style.id && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {style.description}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Page Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Page Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Page Size</Label>
                <Select
                  value={layoutData.customizations?.pageSize || "6x9"}
                  onValueChange={(value) => updateCustomization("pageSize", value)}
                >
                  <SelectTrigger data-testid="select-page-size">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZES.map((size) => (
                      <SelectItem key={size.id} value={size.id}>
                        {size.name} - {size.description}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Separator />

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="show-nutrition">Show Nutrition Info</Label>
                  <input
                    type="checkbox"
                    id="show-nutrition"
                    checked={layoutData.customizations?.showNutrition !== false}
                    onChange={(e) => updateCustomization("showNutrition", e.target.checked)}
                    className="h-4 w-4"
                    data-testid="checkbox-nutrition"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="show-page-numbers">Show Page Numbers</Label>
                  <input
                    type="checkbox"
                    id="show-page-numbers"
                    checked={layoutData.customizations?.showPageNumbers !== false}
                    onChange={(e) => updateCustomization("showPageNumbers", e.target.checked)}
                    className="h-4 w-4"
                    data-testid="checkbox-page-numbers"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Project Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Project Info</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Sections</span>
                  <span className="font-medium" data-testid="text-section-count">{layoutData?.sections?.length || 0}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Total Recipes</span>
                  <span className="font-medium" data-testid="text-recipe-count">
                    {(layoutData?.sections || []).reduce((sum, s) => sum + s.recipeIds.length, 0)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Est. Pages</span>
                  <span className="font-medium" data-testid="text-page-estimate">~{estimatedPageCount}</span>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <Badge variant={currentProject ? "secondary" : "outline"} data-testid="badge-status">
                    {currentProject ? "Saved" : "New"}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Preflight Check */}
          <PreflightCheckPanel
            cookbookId={cookbookId}
            layoutData={layoutData}
            templateStyle={templateStyle}
          />

          {/* Print Order */}
          <PrintOrderPanel
            cookbookId={cookbookId}
            layoutData={layoutData}
            estimatedPageCount={estimatedPageCount}
            pageSize={layoutData.customizations?.pageSize || "6x9"}
          />
        </div>
      </div>

      {/* Print Preview Modal */}
      <CookbookPrintPreview
        open={showPreview}
        onClose={() => setShowPreview(false)}
        layoutData={layoutData}
        templateStyle={templateStyle}
        cookbookId={cookbookId}
      />
    </div>
  );
}

export default function CookbookPrintEditor() {
  return (
    <PrintEditorErrorBoundary>
      <CookbookPrintEditorInner />
    </PrintEditorErrorBoundary>
  );
}

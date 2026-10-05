import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BookOpen, Check, ChevronDown, GripVertical, MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { OrganizeByCourse } from "@/components/organize-by-course";
import { cn } from "@/lib/utils";
import type { RecipeSummary, Section } from "./types";

// Step 1: which recipes go in the book, and in which chapters. Drag to
// reorder, or use each recipe's menu (Move up/down, Move to chapter) — every
// drag has a button alternative (WCAG 2.5.7).

interface RecipesStepProps {
  cookbookId: number;
  sections: Section[];
  allRecipes: RecipeSummary[];
  onChange: (sections: Section[], undoMessage?: string) => void;
}

function Thumb({ recipe, size = "h-12 w-12" }: { recipe: RecipeSummary; size?: string }) {
  return recipe.dishImageThumbnail ? (
    <img src={recipe.dishImageThumbnail} alt="" className={cn(size, "shrink-0 rounded object-cover")} />
  ) : (
    <div className={cn(size, "flex shrink-0 items-center justify-center rounded bg-muted")}>
      <BookOpen className="h-5 w-5 text-muted-foreground" aria-hidden />
    </div>
  );
}

export function RecipesStep({ cookbookId, sections, allRecipes, onChange }: RecipesStepProps) {
  const recipesById = useMemo(() => new Map(allRecipes.map((r) => [r.id, r])), [allRecipes]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(sections.length === 1 ? [sections[0].id] : []));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newChapterOpen, setNewChapterOpen] = useState(false);
  const [newChapterTitle, setNewChapterTitle] = useState("");
  const [addingTo, setAddingTo] = useState<Section | null>(null);

  const inBook = useMemo(() => new Set(sections.flatMap((s) => s.recipeIds)), [sections]);
  const notInBook = allRecipes.filter((r) => !inBook.has(r.id));
  const totalInBook = sections.reduce((n, s) => n + s.recipeIds.filter((id) => recipesById.has(id)).length, 0);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const setSection = (id: string, change: (s: Section) => Section, undoMessage?: string) =>
    onChange(sections.map((s) => (s.id === id ? change(s) : s)), undoMessage);

  const moveRecipe = (fromId: string, recipeId: string, toId: string) => {
    onChange(
      sections.map((s) => {
        if (s.id === fromId) return { ...s, recipeIds: s.recipeIds.filter((r) => r !== recipeId) };
        if (s.id === toId) return { ...s, recipeIds: [...s.recipeIds, recipeId] };
        return s;
      }),
    );
  };

  const moveSection = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= sections.length) return;
    onChange(arrayMove(sections, index, j));
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const section = sections.find((s) => s.recipeIds.includes(String(active.id)));
    if (!section || !section.recipeIds.includes(String(over.id))) return;
    setSection(section.id, (s) => ({
      ...s,
      recipeIds: arrayMove(s.recipeIds, s.recipeIds.indexOf(String(active.id)), s.recipeIds.indexOf(String(over.id))),
    }));
  };

  const addChapter = () => {
    const title = newChapterTitle.trim();
    if (!title) return;
    const section: Section = { id: crypto.randomUUID(), title, recipeIds: [] };
    onChange([...sections, section]);
    setExpanded((prev) => new Set(prev).add(section.id));
    setNewChapterTitle("");
    setNewChapterOpen(false);
  };

  return (
    <div className="space-y-6">
      <p className="text-base text-muted-foreground">
        {totalInBook} recipe{totalInBook === 1 ? "" : "s"} in {sections.length} chapter{sections.length === 1 ? "" : "s"}. Each
        chapter starts with its own title page.
      </p>

      {notInBook.length > 0 && sections.length > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center">
          <p className="flex-1 text-sm">
            {notInBook.length} recipe{notInBook.length === 1 ? " in this cookbook isn't" : "s in this cookbook aren't"} in the book yet.
          </p>
          <Button
            variant="outline"
            onClick={() => {
              const last = sections[sections.length - 1];
              setSection(last.id, (s) => ({ ...s, recipeIds: [...s.recipeIds, ...notInBook.map((r) => r.id)] }));
            }}
          >
            Add {notInBook.length === 1 ? "it" : "them"} to “{sections[sections.length - 1].title}”
          </Button>
        </div>
      )}

      <OrganizeByCourse
        cookbookId={cookbookId}
        hasExistingSections={sections.length > 1}
        onApply={(next) => onChange(next, "Organized by course")}
      />

      <section aria-labelledby="chapters-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="chapters-heading" className="text-xl font-semibold">Chapters</h2>
          <Button variant="outline" onClick={() => setNewChapterOpen(true)} data-testid="button-add-section">
            <Plus aria-hidden /> Add chapter
          </Button>
        </div>

        {sections.length === 0 ? (
          <div className="rounded-lg border border-dashed px-6 py-10 text-center">
            <BookOpen className="mx-auto mb-3 h-10 w-10 text-muted-foreground" aria-hidden />
            <p className="font-medium">No chapters yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Add a chapter, or use Organize by course to make them for you.</p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveId(null)}
          >
            <ol className="space-y-3">
              {sections.map((section, index) => {
                const recipes = section.recipeIds.map((id) => recipesById.get(id)).filter((r): r is RecipeSummary => !!r);
                const open = expanded.has(section.id);
                return (
                  <li key={section.id} className="rounded-lg border bg-card" data-testid={`section-${section.id}`}>
                    <ChapterHeader
                      section={section}
                      count={recipes.length}
                      open={open}
                      onToggle={() =>
                        setExpanded((prev) => {
                          const next = new Set(prev);
                          if (next.has(section.id)) next.delete(section.id);
                          else next.add(section.id);
                          return next;
                        })
                      }
                      onRename={(title) => setSection(section.id, (s) => ({ ...s, title }))}
                      onMoveUp={index > 0 ? () => moveSection(index, -1) : undefined}
                      onMoveDown={index < sections.length - 1 ? () => moveSection(index, 1) : undefined}
                      onRemove={() => onChange(sections.filter((s) => s.id !== section.id), `Removed “${section.title}”`)}
                    />
                    {open && (
                      <div className="border-t p-3">
                        <SortableContext items={section.recipeIds} strategy={verticalListSortingStrategy}>
                          <ul className="space-y-2">
                            {recipes.map((recipe, i) => (
                              <SortableRecipeRow
                                key={recipe.id}
                                recipe={recipe}
                                otherSections={sections.filter((s) => s.id !== section.id)}
                                onMoveUp={i > 0 ? () => setSection(section.id, (s) => ({ ...s, recipeIds: arrayMove(s.recipeIds, s.recipeIds.indexOf(recipe.id), s.recipeIds.indexOf(recipe.id) - 1) })) : undefined}
                                onMoveDown={i < recipes.length - 1 ? () => setSection(section.id, (s) => ({ ...s, recipeIds: arrayMove(s.recipeIds, s.recipeIds.indexOf(recipe.id), s.recipeIds.indexOf(recipe.id) + 1) })) : undefined}
                                onMoveTo={(toId) => moveRecipe(section.id, recipe.id, toId)}
                                onRemove={() =>
                                  setSection(section.id, (s) => ({ ...s, recipeIds: s.recipeIds.filter((id) => id !== recipe.id) }), `Took “${recipe.title}” out of the book`)
                                }
                              />
                            ))}
                          </ul>
                        </SortableContext>
                        {recipes.length === 0 && (
                          <p className="py-4 text-center text-sm text-muted-foreground">No recipes in this chapter yet.</p>
                        )}
                        <Button variant="outline" className="mt-3 w-full" onClick={() => setAddingTo(section)} data-testid={`add-recipes-${section.id}`}>
                          <Plus aria-hidden /> Add recipes
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            <DragOverlay>
              {activeId && recipesById.get(activeId) ? (
                <div className="flex items-center gap-3 rounded-md border bg-background p-3 shadow-lg">
                  <GripVertical className="h-5 w-5 text-muted-foreground" aria-hidden />
                  <Thumb recipe={recipesById.get(activeId)!} />
                  <span className="text-sm font-medium">{recipesById.get(activeId)!.title}</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </section>

      {/* New chapter */}
      <Dialog open={newChapterOpen} onOpenChange={setNewChapterOpen}>
        <DialogContent>
          <form onSubmit={(e) => { e.preventDefault(); addChapter(); }}>
            <DialogHeader>
              <DialogTitle>New chapter</DialogTitle>
              <DialogDescription>Chapters group recipes, like Breakfast or Grandma's Baking.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-4">
              <Label htmlFor="section-title">Chapter name</Label>
              <Input
                id="section-title"
                placeholder="e.g. Holiday Desserts"
                value={newChapterTitle}
                onChange={(e) => setNewChapterTitle(e.target.value)}
                autoFocus
                data-testid="input-new-section-title"
              />
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setNewChapterOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={!newChapterTitle.trim()} data-testid="confirm-add-section">Add chapter</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {addingTo && (
        <AddRecipesDialog
          section={addingTo}
          available={notInBook}
          onClose={() => setAddingTo(null)}
          onAdd={(ids) => {
            setSection(addingTo.id, (s) => ({ ...s, recipeIds: [...s.recipeIds, ...ids] }));
            setAddingTo(null);
          }}
        />
      )}
    </div>
  );
}

function ChapterHeader({
  section,
  count,
  open,
  onToggle,
  onRename,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  section: Section;
  count: number;
  open: boolean;
  onToggle: () => void;
  onRename: (title: string) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(section.title);

  if (editing) {
    return (
      <form
        className="flex items-center gap-2 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) onRename(title.trim());
          setEditing(false);
        }}
      >
        <Label htmlFor={`rename-${section.id}`} className="sr-only">Chapter name</Label>
        <Input id={`rename-${section.id}`} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus className="h-11" data-testid={`input-section-title-${section.id}`} />
        <Button type="submit" size="icon" aria-label="Save chapter name" data-testid={`save-section-title-${section.id}`}>
          <Check aria-hidden />
        </Button>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-1 p-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left hover:bg-accent/50"
      >
        <ChevronDown className={cn("h-5 w-5 shrink-0 transition-transform", !open && "-rotate-90")} aria-hidden />
        <span className="truncate font-medium">{section.title}</span>
        <span className="shrink-0 text-sm text-muted-foreground">
          {count} recipe{count === 1 ? "" : "s"}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Options for ${section.title}`} data-testid={`edit-section-${section.id}`}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => { setTitle(section.title); setEditing(true); }}>Rename</DropdownMenuItem>
          {onMoveUp && <DropdownMenuItem onClick={onMoveUp}>Move chapter up</DropdownMenuItem>}
          {onMoveDown && <DropdownMenuItem onClick={onMoveDown}>Move chapter down</DropdownMenuItem>}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onClick={onRemove} data-testid={`remove-section-${section.id}`}>
            Remove chapter
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function SortableRecipeRow({
  recipe,
  otherSections,
  onMoveUp,
  onMoveDown,
  onMoveTo,
  onRemove,
}: {
  recipe: RecipeSummary;
  otherSections: Section[];
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onMoveTo: (sectionId: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: recipe.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="flex items-center gap-2 rounded-md border bg-background p-2"
      data-testid={`sortable-recipe-${recipe.id}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="flex h-11 w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded hover:bg-accent"
        aria-label={`Drag to reorder ${recipe.title}`}
        data-testid={`drag-handle-${recipe.id}`}
      >
        <GripVertical className="h-5 w-5 text-muted-foreground" aria-hidden />
      </button>
      <Thumb recipe={recipe} />
      <span className="min-w-0 flex-1 text-sm font-medium break-words">{recipe.title}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Options for ${recipe.title}`}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {onMoveUp && <DropdownMenuItem onClick={onMoveUp}>Move up</DropdownMenuItem>}
          {onMoveDown && <DropdownMenuItem onClick={onMoveDown}>Move down</DropdownMenuItem>}
          {otherSections.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Move to chapter</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 w-56 overflow-y-auto">
                <DropdownMenuLabel className="text-sm font-normal text-muted-foreground">Move to…</DropdownMenuLabel>
                {otherSections.map((s) => (
                  <DropdownMenuItem key={s.id} onClick={() => onMoveTo(s.id)}>{s.title}</DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onClick={onRemove} data-testid={`remove-recipe-${recipe.id}`}>
            Take out of the book
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function AddRecipesDialog({
  section,
  available,
  onClose,
  onAdd,
}: {
  section: Section;
  available: RecipeSummary[];
  onClose: () => void;
  onAdd: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add recipes to “{section.title}”</DialogTitle>
          <DialogDescription>Recipes from this cookbook that aren't in the book yet.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[50vh] pr-3">
          {available.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Every recipe in this cookbook is already in the book. Add more recipes to the cookbook first.
            </p>
          ) : (
            <ul className="space-y-2">
              {available.map((r) => {
                const on = selected.includes(r.id);
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(r.id)}
                      className={cn("flex w-full items-center gap-3 rounded-md border p-2 text-left", on ? "border-primary bg-primary/5" : "hover:bg-accent/50")}
                      data-testid={`select-recipe-${r.id}`}
                    >
                      <Thumb recipe={r} size="h-11 w-11" />
                      <span className="flex-1 text-sm font-medium">{r.title}</span>
                      {on && <Check className="h-5 w-5 text-primary" aria-label="Selected" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onAdd(selected)} disabled={selected.length === 0} data-testid="confirm-add-recipes">
            Add {selected.length || ""} recipe{selected.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useClerk, useUser } from "@clerk/react";
import { AlertCircle, Check, ChevronDown, Loader2, LogOut, Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PageHeader } from "@/components/page-header";
import { ErrorState, LoadingState } from "@/components/page-states";
import { useTheme } from "@/components/theme-provider";
import { useAuth } from "@/hooks/useAuth";
import { usePreferences, useAutosavePreferences, type SaveStatus } from "@/hooks/use-preferences";
import { useTextSize } from "@/hooks/use-display-prefs";
import { applyAccountUnitDefault, useUnitSystem } from "@/hooks/use-unit-system";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  COOKING_GOAL_OPTIONS,
  CUISINE_OPTIONS,
  DIET_OPTIONS,
  MAX_HOUSEHOLD_SIZE,
  SKILL_LEVEL_OPTIONS,
  foodProfileToPreferences,
  getDisplayPrefs,
  getFoodProfile,
  normalizeIngredientList,
  type DisplayUnits,
  type FoodProfile,
  type TextSize,
  type UserPreferences,
} from "@shared/food-profile";

// The "Me" page: Account, Food profile, Display. One place for every
// preference (docs/DESIGN_PRINCIPLES.md §4). Changes save automatically.

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

type Queue = (patch: Partial<UserPreferences>) => void;

export default function Settings() {
  const { isSignedIn, isLoading, isError, preferences, refetch } = usePreferences();
  const { queue, flush, status } = useAutosavePreferences();

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-6 md:py-10">
        <PageHeader
          title="Me"
          description="Your account, what you like to eat, and how the app looks."
          secondaryActions={isSignedIn ? <SaveIndicator status={status} onRetry={() => void flush()} /> : undefined}
        />

        <div className="space-y-8">
          <Section id="account" title="Account">
            {CLERK_KEY ? <ClerkAccount /> : <LegacyAccount />}
          </Section>

          <Section
            id="food-profile"
            title="Food profile"
            description="Grammie, What Can I Make? and recipe suggestions all use this."
          >
            {!isSignedIn && !isLoading ? (
              <SignInPrompt text="Sign in to save your allergies, diets and favorite foods." />
            ) : isLoading ? (
              <LoadingState label="Loading your food profile" rows={5} />
            ) : isError ? (
              <ErrorState
                title="Your food profile didn't load"
                description="Check your connection and try again."
                onRetry={() => void refetch()}
              />
            ) : (
              <FoodProfileForm preferences={preferences} queue={queue} />
            )}
          </Section>

          <Section id="display" title="Display" description="Text size, units and dark mode.">
            <DisplaySettings signedIn={isSignedIn} preferences={preferences} queue={queue} />
          </Section>

          {isSignedIn && <AdminSettings />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout helpers

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-20">
      <h2 id={`${id}-heading`} className="text-xl font-semibold">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      <Card className="mt-3">
        <CardContent className="space-y-8 p-4 md:p-6">{children}</CardContent>
      </Card>
    </section>
  );
}

function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  return (
    <div aria-live="polite" className={cn("flex items-center gap-2 text-sm", status !== "idle" && "min-h-11")} data-testid="save-status">
      {status === "saving" && (
        <span className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden /> Saving…
        </span>
      )}
      {status === "saved" && (
        <span className="flex items-center gap-2 text-muted-foreground">
          <Check className="h-4 w-4 text-green-700 dark:text-green-400" aria-hidden /> Saved
        </span>
      )}
      {status === "error" && (
        <span role="alert" className="flex flex-wrap items-center gap-2 text-destructive">
          <AlertCircle className="h-4 w-4" aria-hidden />
          Couldn't save. Check your connection.
          <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>
        </span>
      )}
    </div>
  );
}

function SignInPrompt({ text }: { text: string }) {
  return (
    <div className="space-y-3">
      <p className="text-sm">{text}</p>
      <Button asChild>
        <Link href="/login">Sign in</Link>
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Account

function AccountCard({
  name,
  email,
  imageUrl,
  profileHref,
  onManage,
  onSignOut,
}: {
  name: string;
  email?: string | null;
  imageUrl?: string | null;
  profileHref?: string;
  onManage?: () => void;
  onSignOut: () => void;
}) {
  const initials = (name || email || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Avatar className="h-14 w-14">
          <AvatarImage src={imageUrl || undefined} alt="" />
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold" data-testid="text-account-name">{name || "Your account"}</p>
          {email && <p className="truncate text-sm text-muted-foreground" data-testid="text-account-email">{email}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {profileHref && (
          <Button asChild variant="outline">
            <Link href={profileHref}>Your public profile</Link>
          </Button>
        )}
        {onManage && (
          <Button variant="outline" onClick={onManage}>
            Name, email and password
          </Button>
        )}
        <Button variant="outline" onClick={onSignOut} data-testid="button-sign-out">
          <LogOut aria-hidden /> Sign out
        </Button>
      </div>
    </div>
  );
}

function displayName(u: { firstName?: string | null; lastName?: string | null; username?: string | null } | null) {
  if (!u) return "";
  return [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || "";
}

function ClerkAccount() {
  const { user: dbUser, isLoading, isAuthenticated, logout } = useAuth();
  const { isLoaded, isSignedIn, user: clerkUser } = useUser();
  const clerk = useClerk();

  if (isLoading || !isLoaded) return <LoadingState rows={1} label="Loading your account" />;
  if (!isAuthenticated && !isSignedIn) return <SignInPrompt text="Sign in to keep your recipes, cookbooks and settings." />;

  return (
    <AccountCard
      name={clerkUser?.fullName || displayName(dbUser)}
      email={clerkUser?.primaryEmailAddress?.emailAddress || dbUser?.email}
      imageUrl={clerkUser?.imageUrl || dbUser?.avatar}
      profileHref={dbUser ? `/profile/${dbUser.id}` : undefined}
      onManage={isSignedIn ? () => clerk.openUserProfile() : undefined}
      onSignOut={() => {
        queryClient.clear();
        if (isSignedIn) void clerk.signOut({ redirectUrl: "/" });
        else logout();
      }}
    />
  );
}

function LegacyAccount() {
  const { user, isLoading, isAuthenticated, logout } = useAuth();
  if (isLoading) return <LoadingState rows={1} label="Loading your account" />;
  if (!isAuthenticated) return <SignInPrompt text="Sign in to keep your recipes, cookbooks and settings." />;
  return (
    <AccountCard
      name={displayName(user)}
      email={user?.email}
      imageUrl={user?.avatar}
      profileHref={user ? `/profile/${user.id}` : undefined}
      onSignOut={() => logout()}
    />
  );
}

// ---------------------------------------------------------------------------
// Food profile

function FoodProfileForm({ preferences, queue }: { preferences: UserPreferences | null; queue: Queue }) {
  // Seed local state once; after that the page is the source of truth so a
  // background refetch never overwrites what someone is typing.
  const [profile, setProfile] = useState<FoodProfile>(() => getFoodProfile(preferences));

  const update = (changes: Partial<FoodProfile>) => {
    const next = { ...profile, ...changes };
    setProfile(next);
    const stored = foodProfileToPreferences(next);
    const patch: Partial<UserPreferences> = {};
    if ("allergies" in changes) patch.allergies = stored.allergies;
    if ("diets" in changes) patch.dietaryRestrictions = stored.dietaryRestrictions;
    if ("dislikes" in changes) patch.dislikedIngredients = stored.dislikedIngredients;
    if ("householdSize" in changes) patch.householdSize = stored.householdSize;
    if ("skillLevel" in changes) patch.cookingSkillLevel = stored.cookingSkillLevel;
    if ("cuisines" in changes) patch.cuisinePreferences = stored.cuisinePreferences;
    if ("goals" in changes) patch.cookingGoals = stored.cookingGoals;
    if ("notes" in changes) patch.grammieNotes = stored.grammieNotes;
    queue(patch);
  };

  return (
    <>
      <ItemListField
        label="Allergies"
        description="Grammie warns you about these, and recipe suggestions leave them out. Always check ingredient labels yourself."
        placeholder="For example, peanuts"
        items={profile.allergies}
        onChange={(allergies) => update({ allergies })}
        emphasis
        testId="allergy"
      />

      <CheckboxGroup
        legend="Diets"
        description="Suggestions only include recipes that fit."
        options={DIET_OPTIONS.map((d) => ({ id: d.id, label: d.label }))}
        selected={profile.diets}
        onChange={(diets) => update({ diets })}
        testId="diet"
        compact
      />

      <ItemListField
        label="Ingredients to avoid"
        description="Foods you'd rather not eat. Suggestions skip recipes that use them."
        placeholder="For example, cilantro"
        items={profile.dislikes}
        onChange={(dislikes) => update({ dislikes })}
        testId="disliked"
      />

      <HouseholdSizeField value={profile.householdSize} onChange={(householdSize) => update({ householdSize })} />

      <MoreAboutCooking profile={profile}>
          <fieldset className="space-y-3">
            <legend className="text-base font-semibold">Cooking experience</legend>
            <p className="text-sm text-muted-foreground">Grammie explains steps in more or less detail.</p>
            <RadioGroup
              value={profile.skillLevel}
              onValueChange={(v) => update({ skillLevel: v as FoodProfile["skillLevel"] })}
              className="gap-2"
            >
              {SKILL_LEVEL_OPTIONS.map((s) => (
                <OptionRow key={s.id} id={`skill-${s.id}`} control={<RadioGroupItem id={`skill-${s.id}`} value={s.id} data-testid={`radio-skill-${s.id}`} />}>
                  <span className="font-medium">{s.label}</span>
                  <span className="text-sm text-muted-foreground"> · {s.hint}</span>
                </OptionRow>
              ))}
            </RadioGroup>
          </fieldset>

          <CheckboxGroup
            legend="Favorite cuisines"
            description="Used for suggestions. Leave blank for anything."
            options={CUISINE_OPTIONS.map((c) => ({ id: c, label: c }))}
            selected={profile.cuisines}
            onChange={(cuisines) => update({ cuisines })}
            testId="cuisine"
            compact
          />

          <CheckboxGroup
            legend="Cooking goals"
            options={COOKING_GOAL_OPTIONS.map((g) => ({ id: g.id, label: g.label }))}
            selected={profile.goals}
            onChange={(goals) => update({ goals })}
            testId="goal"
          />

          <div className="space-y-2">
            <Label htmlFor="grammie-notes" className="text-base font-semibold">
              Notes for Grammie <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <p id="grammie-notes-help" className="text-sm text-muted-foreground">
              Anything else Grammie should remember, like "Dad doesn't like spicy food" or "I prefer one-pot meals".
            </p>
            <Textarea
              id="grammie-notes"
              aria-describedby="grammie-notes-help"
              value={profile.notes}
              maxLength={2000}
              onChange={(e) => update({ notes: e.target.value })}
              className="min-h-28 text-base"
              data-testid="textarea-grammie-notes"
            />
          </div>
      </MoreAboutCooking>
    </>
  );
}

function MoreAboutCooking({ profile, children }: { profile: FoodProfile; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const skill = SKILL_LEVEL_OPTIONS.find((o) => o.id === profile.skillLevel)?.label;
  const summary = [
    skill,
    profile.cuisines.length ? `${profile.cuisines.length} cuisine${profile.cuisines.length === 1 ? "" : "s"}` : null,
    profile.goals.length ? `${profile.goals.length} goal${profile.goals.length === 1 ? "" : "s"}` : null,
    profile.notes.trim() ? "notes" : null,
  ].filter(Boolean).join(" · ");
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="space-y-6">
      <CollapsibleTrigger asChild>
        <Button variant="outline" className="h-auto w-full justify-between py-2 text-left" data-testid="button-more-food-profile">
          <span className="flex flex-col">
            <span className="text-base font-semibold">More about how you cook</span>
            <span className="whitespace-normal text-sm font-normal text-muted-foreground">
              Experience, favorite cuisines, goals and notes{summary ? ` (${summary})` : ""}
            </span>
          </span>
          <ChevronDown className={cn("motion-safe:transition-transform", open && "rotate-180")} aria-hidden />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-8">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function OptionRow({ id, control, children }: { id: string; control: ReactNode; children: ReactNode }) {
  // The whole row is the label, so the tap target is the full 44 px row
  return (
    <label
      htmlFor={id}
      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-base leading-snug hover:bg-accent/40 has-[[data-state=checked]]:border-primary"
    >
      {control}
      <span className="flex-1">{children}</span>
    </label>
  );
}

function CheckboxGroup({
  legend,
  description,
  options,
  selected,
  onChange,
  testId,
  compact,
}: {
  legend: string;
  description?: string;
  options: { id: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  testId: string;
  /** Two columns on phones too (for short labels) */
  compact?: boolean;
}) {
  const base = useId();
  return (
    <fieldset className="space-y-3">
      <legend className="text-base font-semibold">{legend}</legend>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
      <div className={cn("grid gap-2 sm:grid-cols-2", compact ? "grid-cols-2" : "grid-cols-1")}>
        {options.map((o) => {
          const id = `${base}-${o.id}`;
          const checked = selected.includes(o.id);
          return (
            <OptionRow
              key={o.id}
              id={id}
              control={
                <Checkbox
                  id={id}
                  checked={checked}
                  onCheckedChange={(c) => onChange(c ? [...selected, o.id] : selected.filter((s) => s !== o.id))}
                  data-testid={`checkbox-${testId}-${o.id.toLowerCase()}`}
                />
              }
            >
              {o.label}
            </OptionRow>
          );
        })}
      </div>
    </fieldset>
  );
}

function ItemListField({
  label,
  description,
  placeholder,
  items,
  onChange,
  emphasis,
  testId,
}: {
  label: string;
  description: string;
  placeholder: string;
  items: string[];
  onChange: (next: string[]) => void;
  emphasis?: boolean;
  testId: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState("");

  const add = (e: FormEvent) => {
    e.preventDefault();
    // Allow "peanuts, shellfish" in one go
    const added = normalizeIngredientList(draft.split(","));
    if (added.length) onChange(normalizeIngredientList([...items, ...added]));
    setDraft("");
  };

  return (
    <div className="space-y-3">
      <Label htmlFor={id} className="text-base font-semibold">{label}</Label>
      <p id={`${id}-help`} className="text-sm text-muted-foreground">{description}</p>
      <form onSubmit={add} className="flex gap-2">
        <Input
          id={id}
          aria-describedby={`${id}-help`}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          className="h-11 text-base"
          data-testid={`input-${testId}`}
        />
        <Button type="submit" variant="outline" disabled={!draft.trim()} data-testid={`button-add-${testId}`}>
          <Plus aria-hidden /> Add
        </Button>
      </form>
      {items.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label={label}>
          {items.map((item) => (
            <li
              key={item}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full border pl-4 text-base",
                emphasis ? "border-destructive/60 bg-destructive/10" : "bg-secondary",
              )}
            >
              {emphasis && <AlertCircle className="mr-2 h-4 w-4 text-destructive" aria-hidden />}
              {item}
              <button
                type="button"
                onClick={() => onChange(items.filter((i) => i !== item))}
                className="ml-1 inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Remove ${item}`}
                data-testid={`button-remove-${testId}-${item}`}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">None added.</p>
      )}
    </div>
  );
}

function HouseholdSizeField({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  const lastValue = useRef(value);

  useEffect(() => {
    if (value !== lastValue.current) {
      lastValue.current = value;
      setText(String(value));
    }
  }, [value]);

  const commit = (n: number) => {
    const clamped = Math.min(MAX_HOUSEHOLD_SIZE, Math.max(1, n));
    lastValue.current = clamped;
    setText(String(clamped));
    setError(null);
    if (clamped !== value) onChange(clamped);
  };

  return (
    <div className="space-y-3">
      <Label htmlFor="household-size" className="text-base font-semibold">How many people you usually cook for</Label>
      <p id="household-size-help" className="text-sm text-muted-foreground">Grammie uses this to suggest portions.</p>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="icon" aria-label="Fewer people" disabled={value <= 1} onClick={() => commit(value - 1)}>
          <Minus aria-hidden />
        </Button>
        <Input
          id="household-size"
          aria-describedby={error ? "household-size-error" : "household-size-help"}
          aria-invalid={!!error}
          inputMode="numeric"
          pattern="[0-9]*"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(null);
          }}
          onBlur={() => {
            const n = parseInt(text, 10);
            if (!Number.isFinite(n) || n < 1 || n > MAX_HOUSEHOLD_SIZE) {
              setError(`Enter a number from 1 to ${MAX_HOUSEHOLD_SIZE}.`);
              return;
            }
            commit(n);
          }}
          className="h-11 w-20 text-center text-base"
          data-testid="input-household-size"
        />
        <Button type="button" variant="outline" size="icon" aria-label="More people" disabled={value >= MAX_HOUSEHOLD_SIZE} onClick={() => commit(value + 1)}>
          <Plus aria-hidden />
        </Button>
        <span className="text-base">{value === 1 ? "person" : "people"}</span>
      </div>
      {error && <p id="household-size-error" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Display

const TEXT_SIZE_OPTIONS: { id: TextSize; label: string }[] = [
  { id: "default", label: "Default" },
  { id: "large", label: "Large" },
  { id: "xlarge", label: "Extra large" },
];

const UNIT_OPTIONS: { id: DisplayUnits; label: string; hint: string }[] = [
  { id: "original", label: "As written", hint: "Exactly as the recipe says" },
  { id: "us", label: "US", hint: "Cups, ounces, °F" },
  { id: "metric", label: "Metric", hint: "Grams, milliliters, °C" },
];

function DisplaySettings({ signedIn, preferences, queue }: { signedIn: boolean; preferences: UserPreferences | null; queue: Queue }) {
  const [textSize, setTextSize] = useTextSize();
  // Show the saved account default, not whatever a recipe toggle last chose
  const [deviceUnits] = useUnitSystem();
  const savedUnits = getDisplayPrefs(preferences).units;
  const [units, setUnits] = useState<DisplayUnits>(savedUnits ?? deviceUnits);
  const seeded = useRef(!!savedUnits);
  useEffect(() => {
    if (!seeded.current && savedUnits) {
      seeded.current = true;
      setUnits(savedUnits);
    }
  }, [savedUnits]);
  const { theme, setTheme } = useTheme();

  return (
    <>
      <fieldset className="space-y-3">
        <legend className="text-base font-semibold">Text size</legend>
        <RadioGroup
          value={textSize}
          onValueChange={(v) => {
            const size = v as TextSize;
            setTextSize(size);
            if (signedIn) queue({ display: { textSize: size } });
          }}
          className="grid grid-cols-1 gap-2 sm:grid-cols-3"
        >
          {TEXT_SIZE_OPTIONS.map((o) => (
            <OptionRow key={o.id} id={`text-size-${o.id}`} control={<RadioGroupItem id={`text-size-${o.id}`} value={o.id} data-testid={`radio-text-size-${o.id}`} />}>
              {o.label}
            </OptionRow>
          ))}
        </RadioGroup>
        <p className="text-sm text-muted-foreground">Changes the size of text and buttons across the app.</p>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-base font-semibold">Units</legend>
        <p className="text-sm text-muted-foreground">
          How ingredient amounts show by default. You can still switch on any recipe.
        </p>
        <RadioGroup
          value={units}
          onValueChange={(v) => {
            const u = v as DisplayUnits;
            setUnits(u);
            applyAccountUnitDefault(u);
            if (signedIn) queue({ display: { units: u } });
          }}
          className="gap-2"
        >
          {UNIT_OPTIONS.map((o) => (
            <OptionRow key={o.id} id={`units-${o.id}`} control={<RadioGroupItem id={`units-${o.id}`} value={o.id} data-testid={`radio-units-${o.id}`} />}>
              <span className="font-medium">{o.label}</span>
              <span className="text-sm text-muted-foreground"> · {o.hint}</span>
            </OptionRow>
          ))}
        </RadioGroup>
      </fieldset>

      <div className="flex min-h-11 items-center justify-between gap-4">
        <div>
          <Label htmlFor="dark-mode" className="text-base font-semibold">Dark mode</Label>
          <p className="text-sm text-muted-foreground">Light text on a dark background. Saved on this device.</p>
        </div>
        <Switch
          id="dark-mode"
          checked={theme === "dark"}
          onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
          data-testid="switch-dark-mode"
        />
      </div>

      {!signedIn && (
        <p className="text-sm text-muted-foreground">These are saved on this device. Sign in to keep them everywhere.</p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Admin (only shown to admins, behind "Advanced")

interface AIProviderInfo {
  currentProvider: "openai" | "gemini";
  hasRuntimeOverride: boolean;
  envDefault: string;
  providers: {
    openai: { available: boolean; description: string };
    gemini: { available: boolean; description: string };
  };
}

function AdminSettings() {
  const [open, setOpen] = useState(false);
  const { data: info } = useQuery<AIProviderInfo | null>({
    queryKey: ["/api/admin/ai-provider"],
    queryFn: async () => {
      const response = await fetch("/api/admin/ai-provider", { credentials: "include" });
      if (response.status === 403 || response.status === 401) return null; // not an admin
      if (!response.ok) throw new Error("Failed to fetch AI provider info");
      return response.json();
    },
    retry: false,
  });

  const updateProvider = useMutation({
    mutationFn: async (provider: "openai" | "gemini") => {
      const response = await fetch("/api/admin/ai-provider", {
        method: "PUT",
        body: JSON.stringify({ provider }),
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Couldn't switch the AI provider. Try again.");
      }
      return response.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-provider"] }),
  });

  if (!info) return null;

  const providers = [
    { id: "openai" as const, label: "OpenAI", ...info.providers.openai },
    { id: "gemini" as const, label: "Google Gemini", ...info.providers.gemini },
  ];

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-between" aria-expanded={open}>
          Advanced (admin)
          <ChevronDown className={cn("transition-transform", open && "rotate-180")} aria-hidden />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Card className="mt-3">
          <CardContent className="space-y-3 p-4 md:p-6">
            <fieldset className="space-y-3">
              <legend className="text-base font-semibold">AI provider for recipe uploads</legend>
              <p className="text-sm text-muted-foreground">Takes effect immediately for new uploads.</p>
              <RadioGroup
                value={info.currentProvider}
                onValueChange={(v) => updateProvider.mutate(v as "openai" | "gemini")}
                disabled={updateProvider.isPending}
                className="gap-2"
              >
                {providers.map((p) => (
                  <OptionRow
                    key={p.id}
                    id={`provider-${p.id}`}
                    control={<RadioGroupItem id={`provider-${p.id}`} value={p.id} disabled={!p.available || updateProvider.isPending} data-testid={`radio-provider-${p.id}`} />}
                  >
                    <span className="font-medium">{p.label}</span>
                    {!p.available && <span className="text-sm text-destructive"> · Not configured</span>}
                    <span className="block text-sm text-muted-foreground">{p.description}</span>
                  </OptionRow>
                ))}
              </RadioGroup>
              {updateProvider.isPending && <p className="text-sm text-muted-foreground">Switching provider…</p>}
              {updateProvider.isError && (
                <p role="alert" className="text-sm text-destructive">{(updateProvider.error as Error).message}</p>
              )}
              {info.hasRuntimeOverride && (
                <p className="text-sm text-muted-foreground">Runtime override active. Environment default: {info.envDefault.toUpperCase()}</p>
              )}
            </fieldset>
          </CardContent>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
}

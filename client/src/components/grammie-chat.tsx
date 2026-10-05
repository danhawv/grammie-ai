import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, X, Send, Loader2, Clock, Flame, ChefHat, ArrowLeft, ArrowRight } from "lucide-react";
import { Link, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import grammieImage from "@assets/image_1763329917086.png";

interface RecipeResult {
  id: string;
  title: string;
  description?: string;
  totalTimeMinutes?: number;
  calories?: number;
  protein?: number;
  cuisines?: string[];
  url: string;
}

interface GrammieResponse {
  message: string;
  recipes: RecipeResult[];
  suggestedFollowUps?: string[];
}

interface ChatMessage {
  id: string;
  role: "user" | "grammie";
  content: string;
  recipes?: RecipeResult[];
  suggestedFollowUps?: string[];
  timestamp: Date;
}

const SUGGESTED_QUERIES = [
  "Quick dinner under 30 minutes",
  "High protein recipes",
  "What can I make with chicken?",
  "Easy breakfast ideas",
  "Show me vegetarian options",
];

// Floating buttons never cover recipes, forms or editors (DESIGN_PRINCIPLES §3)
const HIDE_ON = [/^\/recipe\//, /^\/recipe-creator/, /^\/cookbook\/\d+\/print/, /^\/login/, /^\/settings/, /^\/processing/, /^\/kitchen/, /^\/meal-plans\//];

export function GrammieChat() {
  const [location] = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [isDismissed, setIsDismissed] = useState(() => {
    return localStorage.getItem("grammie-dismissed") === "true";
  });
  const [position, setPosition] = useState<"right" | "left">(() => {
    return (localStorage.getItem("grammie-position") as "right" | "left") || "right";
  });
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "grammie",
      content: "Hello, dear! I'm Grammie. Ask me anything about your recipes - like 'quick dinners under 30 minutes' or 'high protein meals'. I know all about your collection!",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDismissed(true);
    localStorage.setItem("grammie-dismissed", "true");
  };

  const handleRestore = () => {
    setIsDismissed(false);
    localStorage.removeItem("grammie-dismissed");
  };

  const togglePosition = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newPosition = position === "right" ? "left" : "right";
    setPosition(newPosition);
    localStorage.setItem("grammie-position", newPosition);
  };

  // Get the most recent recipes shown by Grammie for context
  const getRecentRecipeIds = (): string[] => {
    // Find the last grammie message that had recipes
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "grammie" && msg.recipes && msg.recipes.length > 0) {
        return msg.recipes.map(r => r.id);
      }
    }
    return [];
  };

  const chatMutation = useMutation({
    mutationFn: async (message: string) => {
      const contextRecipeIds = getRecentRecipeIds();
      const response = await apiRequest("POST", "/api/grammie/chat", { 
        message,
        contextRecipeIds: contextRecipeIds.length > 0 ? contextRecipeIds : undefined
      });
      return response.json() as Promise<GrammieResponse>;
    },
    onSuccess: (data) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `grammie-${Date.now()}`,
          role: "grammie",
          content: data.message,
          recipes: data.recipes,
          suggestedFollowUps: data.suggestedFollowUps,
          timestamp: new Date(),
        },
      ]);
    },
    onError: () => {
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "grammie",
          content: "Oh my, something went wrong, dear. Let me try that again in a moment.",
          timestamp: new Date(),
        },
      ]);
    },
  });

  const handleSend = (messageText?: string) => {
    const text = messageText || input.trim();
    if (!text || chatMutation.isPending) return;

    setMessages((prev) => [
      ...prev,
      {
        id: `user-${Date.now()}`,
        role: "user",
        content: text,
        timestamp: new Date(),
      },
    ]);
    setInput("");
    chatMutation.mutate(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // When dismissed, show a tiny restore button
  if (!isOpen && HIDE_ON.some((r) => r.test(location))) return null;

  // Phones: sits just above the tab bar, small and icon-only so it covers as
  // little as possible. Desktop: the labeled pill in the corner.
  const corner = position === "right" ? "right-4 md:right-6" : "left-4 md:left-6";
  const bottom = "bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] md:bottom-6";

  if (isDismissed) {
    return (
      <button
        type="button"
        onClick={handleRestore}
        className={`fixed ${bottom} ${corner} z-50 flex h-11 w-11 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-md transition-colors hover:text-foreground`}
        aria-label="Show Ask Grammie"
        title="Show Ask Grammie"
        data-testid="button-restore-grammie"
      >
        <MessageCircle className="h-5 w-5" aria-hidden />
      </button>
    );
  }

  if (!isOpen) {
    return (
      <div className={`fixed ${bottom} ${corner} z-50 flex flex-col ${position === "right" ? "items-end" : "items-start"} gap-1 group`}>
        {/* Move / hide: desktop only, on hover or keyboard focus */}
        <div className="hidden gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 md:flex">
          <button
            type="button"
            onClick={togglePosition}
            className="flex h-11 w-11 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-foreground"
            aria-label={`Move Ask Grammie to the ${position === "right" ? "left" : "right"}`}
            title={`Move to the ${position === "right" ? "left" : "right"}`}
            data-testid="button-move-grammie"
          >
            {position === "right" ? <ArrowLeft className="h-4 w-4" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="flex h-11 w-11 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-foreground"
            aria-label="Hide Ask Grammie"
            title="Hide Ask Grammie"
            data-testid="button-dismiss-grammie"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* Phone: a compact 48px avatar button */}
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-primary shadow-lg ring-2 ring-background md:hidden"
          aria-label="Ask Grammie"
          title="Ask Grammie"
          data-testid="button-open-grammie-compact"
        >
          <MessageCircle className="h-6 w-6 text-primary-foreground" aria-hidden />
        </button>

        {/* Desktop: labeled pill */}
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="hidden items-center gap-2 rounded-full bg-primary py-2 pl-2 pr-4 text-primary-foreground shadow-lg transition-colors hover:bg-primary/90 md:flex"
          data-testid="button-open-grammie"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-foreground/15">
            <MessageCircle className="h-5 w-5" aria-hidden />
          </span>
          <span className="text-sm font-medium">Ask Grammie</span>
        </button>
      </div>
    );
  }

  return (
    <Card
      role="dialog"
      aria-label="Ask Grammie"
      className={`fixed ${bottom} ${corner} z-50 flex h-[600px] max-h-[calc(100dvh-10rem)] w-[380px] max-w-[calc(100vw-2rem)] flex-col shadow-2xl md:max-h-[calc(100vh-6rem)]`}
      data-testid="grammie-chat-panel"
    >
      {/* Header */}
      <CardHeader className="flex-shrink-0 flex flex-row items-center justify-between gap-2 py-3 px-4 border-b">
        <div className="flex items-center gap-2">
          <img 
            src={grammieImage} 
            alt="Grammie" 
            className="w-10 h-10 rounded-full object-cover"
          />
          <div>
            <CardTitle className="text-base">Ask Grammie</CardTitle>
            <p className="text-xs text-muted-foreground">Your recipe assistant</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsOpen(false)}
          aria-label="Close Ask Grammie"
          title="Close"
          data-testid="button-close-grammie"
        >
          <X className="w-5 h-5" aria-hidden />
        </Button>
      </CardHeader>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] ${
                  message.role === "user"
                    ? "bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-4 py-2"
                    : "space-y-3"
                }`}
              >
                {message.role === "grammie" && (
                  <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-2">
                    <p className="text-sm">{message.content}</p>
                  </div>
                )}
                {message.role === "user" && (
                  <p className="text-sm">{message.content}</p>
                )}

                {/* Recipe Results */}
                {message.recipes && message.recipes.length > 0 && (
                  <div className="space-y-2">
                    {message.recipes.map((recipe) => (
                      <Link
                        key={recipe.id}
                        href={`/recipe/${recipe.id}`}
                        onClick={() => setIsOpen(false)}
                      >
                        <div
                          className="bg-card border rounded-lg p-3 hover-elevate cursor-pointer transition-all"
                          data-testid={`grammie-recipe-${recipe.id}`}
                        >
                          <p className="font-medium text-sm text-foreground">{recipe.title}</p>
                          <div className="flex flex-wrap gap-2 mt-1.5">
                            {recipe.totalTimeMinutes && (
                              <Badge variant="secondary" className="text-xs gap-1">
                                <Clock className="w-3 h-3" />
                                {recipe.totalTimeMinutes} min
                              </Badge>
                            )}
                            {recipe.calories && (
                              <Badge variant="secondary" className="text-xs gap-1">
                                <Flame className="w-3 h-3" />
                                {recipe.calories} cal
                              </Badge>
                            )}
                            {recipe.protein && (
                              <Badge variant="outline" className="text-xs">
                                {recipe.protein}g protein
                              </Badge>
                            )}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}

                {/* Suggested Follow-ups */}
                {message.suggestedFollowUps && message.suggestedFollowUps.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {message.suggestedFollowUps.map((suggestion, i) => (
                      <Button
                        key={i}
                        variant="outline"
                        size="sm"
                        className="h-auto min-h-11 whitespace-normal text-left"
                        onClick={() => handleSend(suggestion)}
                        disabled={chatMutation.isPending}
                        data-testid={`grammie-suggestion-${i}`}
                      >
                        {suggestion}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Loading indicator */}
          {chatMutation.isPending && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-2">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}

          {/* Initial suggestions (only show if no user messages yet) */}
          {messages.length === 1 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Try asking:</p>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTED_QUERIES.map((query, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    size="sm"
                    className="h-auto min-h-11 whitespace-normal text-left"
                    onClick={() => handleSend(query)}
                    disabled={chatMutation.isPending}
                    data-testid={`grammie-initial-${i}`}
                  >
                    {query}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="flex-shrink-0 p-3 border-t">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about recipes..."
            aria-label="Message to Grammie"
            disabled={chatMutation.isPending}
            className="flex-1"
            data-testid="input-grammie-message"
          />
          <Button
            onClick={() => handleSend()}
            disabled={!input.trim() || chatMutation.isPending}
            size="icon"
            aria-label="Send"
            title="Send"
            data-testid="button-send-grammie"
          >
            {chatMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>
    </Card>
  );
}

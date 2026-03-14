import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, X, Send, Loader2, Clock, Flame, ChefHat, ArrowLeft, ArrowRight } from "lucide-react";
import { Link } from "wouter";
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

export function GrammieChat() {
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
  if (isDismissed) {
    return (
      <button
        onClick={handleRestore}
        className={`fixed bottom-6 ${position === "right" ? "right-6" : "left-6"} z-50 p-2 bg-muted hover:bg-muted/80 text-muted-foreground rounded-full shadow-md transition-all hover:scale-105 opacity-60 hover:opacity-100`}
        title="Bring back Grammie"
        data-testid="button-restore-grammie"
      >
        <MessageCircle className="w-5 h-5" />
      </button>
    );
  }

  if (!isOpen) {
    return (
      <div className={`fixed bottom-6 ${position === "right" ? "right-6" : "left-6"} z-50 flex flex-col ${position === "right" ? "items-end" : "items-start"} gap-1 group`}>
        {/* Control buttons - visible on hover (desktop) or always visible on mobile */}
        <div className="flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
          <button
            onClick={togglePosition}
            className="p-1.5 bg-muted/80 hover:bg-muted text-muted-foreground rounded-full transition-all"
            title={`Move to ${position === "right" ? "left" : "right"} side`}
            data-testid="button-move-grammie"
          >
            {position === "right" ? <ArrowLeft className="w-3 h-3" /> : <ArrowRight className="w-3 h-3" />}
          </button>
          <button
            onClick={handleDismiss}
            className="p-1.5 bg-muted/80 hover:bg-muted text-muted-foreground rounded-full transition-all"
            title="Hide Grammie"
            data-testid="button-dismiss-grammie"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
        
        {/* Main button */}
        <button
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-full shadow-lg transition-all hover:scale-105"
          data-testid="button-open-grammie"
        >
          <img 
            src={grammieImage} 
            alt="Grammie" 
            className="w-10 h-10 rounded-full object-cover border-2 border-primary-foreground/20"
          />
          <span className="font-medium text-sm">Ask Grammie</span>
        </button>
      </div>
    );
  }

  return (
    <Card className={`fixed bottom-6 ${position === "right" ? "right-6" : "left-6"} z-50 w-[380px] max-w-[calc(100vw-3rem)] h-[600px] max-h-[calc(100vh-6rem)] flex flex-col shadow-2xl`} data-testid="grammie-chat-panel">
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
          data-testid="button-close-grammie"
        >
          <X className="w-4 h-4" />
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
                        className="text-xs h-7"
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
              <p className="text-xs text-muted-foreground">Try asking:</p>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTED_QUERIES.map((query, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    size="sm"
                    className="text-xs h-7"
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
            disabled={chatMutation.isPending}
            className="flex-1"
            data-testid="input-grammie-message"
          />
          <Button
            onClick={() => handleSend()}
            disabled={!input.trim() || chatMutation.isPending}
            size="icon"
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

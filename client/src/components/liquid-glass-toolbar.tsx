import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Search, Upload, Menu, ShoppingCart, Settings, Link2, ChefHat, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserHeader } from "@/components/user-header";
import { AlertsButton } from "@/components/alerts-button";
import { PendingInvitationsPopover } from "@/components/pending-invitations-popover";
import { VoiceAssistant } from "@/components/voice-assistant";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

interface LiquidGlassToolbarProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  onUploadClick: () => void;
  onQuickPasteClick: () => void;
  onMenuClick?: () => void;
  showMenuButton?: boolean;
}

export function LiquidGlassToolbar({
  searchValue,
  onSearchChange,
  onUploadClick,
  onQuickPasteClick,
  onMenuClick,
  showMenuButton = false,
}: LiquidGlassToolbarProps) {
  const [scrolled, setScrolled] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <>
      {/* Overscroll cover - prevents content showing when pulling down on mobile */}
      <div 
        className="fixed left-0 right-0 z-50 bg-background"
        style={{ top: '-100vh', height: '100vh' }}
        aria-hidden="true"
      />
      <nav
        className={cn(
          "fixed top-0 left-0 right-0 z-50",
          "glass-regular glass-transition",
          "border-b glass-border",
          scrolled && "glass-scrolled shadow-sm"
        )}
        data-testid="navbar-main"
      >
      <div className="flex items-center justify-between h-16 px-4 md:px-6 max-w-[1920px] mx-auto">
        {/* Leading: Logo & Menu */}
        <div className="flex items-center gap-3">
          {showMenuButton && (
            <Button
              variant="ghost"
              onClick={onMenuClick}
              className="md:hidden inline-flex items-center justify-center touch-target p-0"
              aria-label="Menu"
              data-testid="button-mobile-menu"
            >
              <Menu className="w-5 h-5" strokeWidth={2} />
            </Button>
          )}
          <Link href="/">
            <h1 className="font-serif text-xl md:text-2xl font-bold cursor-pointer hover-elevate transition-transform hover:scale-105">
              Recipe Collection
            </h1>
          </Link>
        </div>

        {/* Center: Search (hidden on small mobile, shown on sm+) */}
        <div className="hidden sm:flex flex-1 max-w-xl mx-4 lg:mx-8">
          <div className="relative w-full">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
              strokeWidth={2}
            />
            <Input
              type="search"
              placeholder="Search recipes..."
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-10 pr-4 h-10 bg-background/50 border-border/50 focus-visible:bg-background/70 transition-colors"
              data-testid="input-search-toolbar"
            />
          </div>
        </div>

        {/* Trailing: Quick Paste, Upload, Grocery List, Settings, Theme, User */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={onQuickPasteClick}
            className="hidden md:inline-flex items-center justify-center gap-1.5 px-3"
            aria-label="Quick paste link"
            data-testid="button-quick-paste-toolbar"
          >
            <Link2 className="w-4 h-4" strokeWidth={2} />
            <span className="text-sm">Paste</span>
          </Button>
          <Button
            variant="default"
            onClick={onUploadClick}
            className="hidden md:inline-flex items-center justify-center touch-target p-0"
            aria-label="Upload recipe"
            data-testid="button-upload-toolbar"
          >
            <Upload className="w-5 h-5" strokeWidth={2} />
          </Button>
          {user && (
            <VoiceAssistant 
              mode="general"
              trigger={
                <Button
                  variant="ghost"
                  size="icon"
                  className="inline-flex items-center justify-center"
                  aria-label="Ask Grammie"
                  data-testid="button-ask-grammie-toolbar"
                >
                  <Mic className="w-5 h-5" strokeWidth={2} />
                </Button>
              }
            />
          )}
          {user && (
            <Link href="/what-can-i-make">
              <Button
                variant="ghost"
                size="icon"
                className="inline-flex items-center justify-center"
                aria-label="What can I make?"
                data-testid="button-what-can-i-make-toolbar"
              >
                <ChefHat className="w-5 h-5" strokeWidth={2} />
              </Button>
            </Link>
          )}
          {user && (
            <Link href="/grocery-list">
              <Button
                variant="ghost"
                size="icon"
                className="inline-flex items-center justify-center"
                aria-label="Grocery list"
                data-testid="button-grocery-list-toolbar"
              >
                <ShoppingCart className="w-5 h-5" strokeWidth={2} />
              </Button>
            </Link>
          )}
          {user && (
            <Link href="/settings">
              <Button
                variant="ghost"
                size="icon"
                className="inline-flex items-center justify-center"
                aria-label="Settings"
                data-testid="button-settings-toolbar"
              >
                <Settings className="w-5 h-5" strokeWidth={2} />
              </Button>
            </Link>
          )}
          {user && <PendingInvitationsPopover />}
          <AlertsButton />
          <UserHeader />
        </div>
      </div>

      {/* Mobile Search Row (shown only on xs screens) */}
      <div className="sm:hidden border-t glass-border px-4 py-2">
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
            strokeWidth={2}
          />
          <Input
            type="search"
            placeholder="Search recipes..."
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10 pr-4 h-10 bg-background/50 border-border/50 focus-visible:bg-background/70 transition-colors"
            data-testid="input-search-mobile"
          />
        </div>
      </div>
    </nav>
    </>
  );
}

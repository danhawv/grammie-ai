import { useAuth } from "@/hooks/useAuth";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { User, LogOut, Settings } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { UserButton, Show, SignInButton } from "@clerk/react";

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function ClerkUserHeader() {
  return (
    <>
      <Show when="signed-out">
        <SignInButton mode="modal">
          <Button
            variant="default"
            className="inline-flex items-center justify-center touch-target px-4"
            data-testid="button-login"
          >
            Sign In
          </Button>
        </SignInButton>
      </Show>
      <Show when="signed-in">
        <UserButton
          {...{ afterSignOutUrl: "/" } as any}
          appearance={{
            elements: {
              avatarBox: "h-8 w-8",
            },
          }}
        />
      </Show>
    </>
  );
}

function LegacyUserHeader() {
  const { user, isLoading, isAuthenticated, logout } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-20" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Link href="/login">
        <Button
          variant="default"
          className="inline-flex items-center justify-center touch-target px-4"
          data-testid="button-login"
        >
          Sign In
        </Button>
      </Link>
    );
  }

  const initials = user?.username
    ? user.username.slice(0, 2).toUpperCase()
    : user?.email?.slice(0, 2).toUpperCase() || "?";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="inline-flex items-center gap-2 hover-elevate touch-target px-2"
          data-testid="button-user-menu"
        >
          <Avatar className="h-8 w-8">
            <AvatarImage src={user?.avatar || undefined} alt={user?.username || user?.email || "User"} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <span className="hidden sm:inline-block text-sm font-medium">
            {user?.username || user?.email}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>My Account</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <Link href={`/profile/${user?.id}`}>
          <DropdownMenuItem className="flex items-center gap-2 cursor-pointer" data-testid="menu-item-profile">
            <User className="h-4 w-4" />
            <span>Profile</span>
          </DropdownMenuItem>
        </Link>
        <Link href="/settings">
          <DropdownMenuItem className="flex items-center gap-2 cursor-pointer" data-testid="menu-item-settings">
            <Settings className="h-4 w-4" />
            <span>Settings</span>
          </DropdownMenuItem>
        </Link>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="flex items-center gap-2 text-destructive focus:text-destructive"
          onClick={() => logout()}
          data-testid="menu-item-logout"
        >
          <LogOut className="h-4 w-4" />
          <span>Sign Out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function UserHeader() {
  if (CLERK_KEY) {
    return <ClerkUserHeader />;
  }
  return <LegacyUserHeader />;
}

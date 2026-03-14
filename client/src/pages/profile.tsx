import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, User, Calendar, Book } from "lucide-react";

interface PublicProfile {
  id: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  bio: string | null;
  avatar: string | null;
  createdAt: string | null;
}

export default function ProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  
  const { data: profile, isLoading, error } = useQuery<PublicProfile>({
    queryKey: ['/api/users', userId, 'profile'],
    queryFn: async () => {
      const response = await fetch(`/api/users/${userId}/profile`);
      if (!response.ok) {
        throw new Error('Profile not found');
      }
      return response.json();
    },
    enabled: !!userId,
  });

  const { data: publicRecipes } = useQuery({
    queryKey: ['/api/recipes', { creatorId: userId }],
    enabled: !!userId,
  });

  if (isLoading) {
    return (
      <div className="container max-w-2xl mx-auto py-8 px-4">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              <Skeleton className="h-20 w-20 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4 mt-2" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="container max-w-2xl mx-auto py-8 px-4">
        <Card>
          <CardContent className="py-12 text-center">
            <User className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">Profile Not Found</h2>
            <p className="text-muted-foreground mb-6">
              This user profile doesn't exist or is not available.
            </p>
            <Link href="/">
              <Button variant="outline">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Recipes
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const displayName = profile.username || 
    [profile.firstName, profile.lastName].filter(Boolean).join(' ') ||
    'Anonymous';
  
  const initials = profile.username?.slice(0, 2).toUpperCase() ||
    [profile.firstName?.[0], profile.lastName?.[0]].filter(Boolean).join('').toUpperCase() ||
    '?';

  const memberSince = profile.createdAt 
    ? new Date(profile.createdAt).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long' 
      })
    : null;

  return (
    <div className="container max-w-2xl mx-auto py-8 px-4">
      <div className="mb-6">
        <Link href="/">
          <Button variant="ghost" size="sm" className="touch-target" data-testid="button-back-home">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Recipes
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <Avatar className="h-20 w-20">
              <AvatarImage src={profile.avatar || undefined} alt={displayName} />
              <AvatarFallback className="text-2xl">{initials}</AvatarFallback>
            </Avatar>
            <div>
              <CardTitle className="text-2xl" data-testid="text-profile-username">
                {displayName}
              </CardTitle>
              {memberSince && (
                <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
                  <Calendar className="h-3 w-3" />
                  <span>Member since {memberSince}</span>
                </div>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {profile.bio ? (
            <p className="text-foreground" data-testid="text-profile-bio">
              {profile.bio}
            </p>
          ) : (
            <p className="text-muted-foreground italic">
              No bio provided
            </p>
          )}
          
          <div className="mt-6 pt-6 border-t">
            <Link href={`/?creatorId=${userId}`}>
              <Button variant="outline" className="touch-target" data-testid="button-view-recipes">
                <Book className="h-4 w-4 mr-2" />
                View Public Recipes
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useUploadProgress } from '@/contexts/UploadProgressContext';
import { Link } from 'wouter';

export function AlertsButton() {
  const { activeRecipes } = useUploadProgress();
  
  const processingCount = activeRecipes.filter(
    r => r.phase !== 'ready' && r.phase !== 'failed'
  ).length;

  return (
    <Link href="/processing">
      <Button 
        variant="ghost" 
        className="inline-flex items-center justify-center touch-target p-0 relative" 
        data-testid="button-alerts" 
        aria-label={`Processing alerts${processingCount > 0 ? ` (${processingCount} processing)` : ''}`}
      >
        <Bell className={`h-5 w-5 ${processingCount > 0 ? 'animate-pulse' : ''}`} />
        {processingCount > 0 && (
          <Badge 
            variant="destructive" 
            className="absolute -top-1 -right-1 h-5 min-w-5 px-1 text-xs flex items-center justify-center"
            data-testid="badge-alerts-count"
          >
            {processingCount}
          </Badge>
        )}
      </Button>
    </Link>
  );
}

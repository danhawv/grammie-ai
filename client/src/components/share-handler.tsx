import { useState, useCallback, useEffect } from 'react';
import { useShareTarget, base64ToFile } from '@/hooks/use-share-target';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { useLocation } from 'wouter';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, ImageIcon, Link2, Upload, CheckCircle2 } from 'lucide-react';
import { useUploadProgress } from '@/contexts/UploadProgressContext';

interface SharedFile {
  name: string;
  type: string;
  size: number;
  base64: string;
}

interface SharedData {
  files: SharedFile[];
  text: string;
  url: string;
  title: string;
}

export function ShareHandler() {
  const [sharedData, setSharedData] = useState<SharedData | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadComplete, setUploadComplete] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { addRecipe } = useUploadProgress();

  const { data: authStatus } = useQuery<{ isAuthenticated: boolean; userId: string | null }>({
    queryKey: ["/api/auth/status"],
    enabled: isOpen,
  });

  const handleShareReceived = useCallback((data: SharedData) => {
    console.log('[Share Handler] Received shared data:', {
      filesCount: data.files.length,
      hasText: !!data.text,
      hasUrl: !!data.url,
    });
    setSharedData(data);
    setIsOpen(true);
    setUploadComplete(false);
  }, []);

  useShareTarget({ onShareReceived: handleShareReceived });

  const uploadImageMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('images', file);

      const response = await fetch('/api/recipes/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || 'Upload failed');
      }

      return response.json();
    },
    onSuccess: (data) => {
      addRecipe(data.id, data.title || 'Shared Recipe');
      
      queryClient.invalidateQueries({ 
        predicate: (query) => query.queryKey[0] === '/api/recipes'
      });
      
      setUploadComplete(true);
      
      setTimeout(() => {
        setIsOpen(false);
        setSharedData(null);
        setUploadComplete(false);
      }, 2000);
    },
    onError: (error: Error) => {
      toast({
        title: 'Upload failed',
        description: error.message,
        variant: 'destructive',
      });
      setIsUploading(false);
    },
  });

  const uploadUrlMutation = useMutation({
    mutationFn: async (url: string) => {
      const response = await apiRequest('POST', '/api/recipes/extract-url', { url });
      return response.json();
    },
    onSuccess: (data) => {
      addRecipe(data.id, data.title || 'Shared Recipe');
      
      queryClient.invalidateQueries({ 
        predicate: (query) => query.queryKey[0] === '/api/recipes'
      });
      
      setUploadComplete(true);
      
      setTimeout(() => {
        setIsOpen(false);
        setSharedData(null);
        setUploadComplete(false);
      }, 2000);
    },
    onError: (error: Error) => {
      toast({
        title: 'Import failed',
        description: error.message,
        variant: 'destructive',
      });
      setIsUploading(false);
    },
  });

  const handleProcess = async () => {
    if (!sharedData) return;
    
    if (!authStatus?.isAuthenticated) {
      toast({
        title: 'Sign in required',
        description: 'Please sign in to save recipes',
        variant: 'destructive',
      });
      setIsOpen(false);
      navigate('/login');
      return;
    }

    setIsUploading(true);

    if (sharedData.files.length > 0) {
      const firstFile = sharedData.files[0];
      const file = base64ToFile(firstFile.base64, firstFile.name, firstFile.type);
      uploadImageMutation.mutate(file);
    } else if (sharedData.url) {
      uploadUrlMutation.mutate(sharedData.url);
    } else if (sharedData.text) {
      const urlMatch = sharedData.text.match(/https?:\/\/[^\s]+/);
      if (urlMatch) {
        uploadUrlMutation.mutate(urlMatch[0]);
      } else {
        toast({
          title: 'No recipe content',
          description: 'The shared content does not contain a recognizable recipe image or link.',
          variant: 'destructive',
        });
        setIsUploading(false);
      }
    } else {
      toast({
        title: 'No content to process',
        description: 'The shared data did not contain an image or link.',
        variant: 'destructive',
      });
      setIsUploading(false);
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    setSharedData(null);
    setIsUploading(false);
    setUploadComplete(false);
  };

  if (!sharedData) return null;

  const hasImage = sharedData.files.length > 0;
  const hasUrl = !!sharedData.url || (sharedData.text && /https?:\/\/[^\s]+/.test(sharedData.text));
  const extractedUrl = sharedData.url || (sharedData.text?.match(/https?:\/\/[^\s]+/)?.[0]);

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {uploadComplete ? (
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            ) : (
              <Upload className="h-5 w-5" />
            )}
            {uploadComplete ? 'Recipe Saved!' : 'Shared Content Received'}
          </DialogTitle>
          <DialogDescription>
            {uploadComplete 
              ? 'Your recipe is being processed by AI. You can close this dialog.'
              : 'Process this content into a recipe?'
            }
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {hasImage && (
            <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
              <div className="h-16 w-16 rounded-md bg-background flex items-center justify-center overflow-hidden">
                <img
                  src={`data:${sharedData.files[0].type};base64,${sharedData.files[0].base64}`}
                  alt="Shared image"
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{sharedData.files[0].name}</p>
                <p className="text-xs text-muted-foreground">
                  {(sharedData.files[0].size / 1024).toFixed(1)} KB
                </p>
              </div>
              <ImageIcon className="h-5 w-5 text-muted-foreground flex-shrink-0" />
            </div>
          )}

          {!hasImage && hasUrl && (
            <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
              <Link2 className="h-8 w-8 text-primary flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">Link detected</p>
                <p className="text-xs text-muted-foreground truncate">
                  {extractedUrl}
                </p>
              </div>
            </div>
          )}

          {!hasImage && !hasUrl && sharedData.text && (
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground line-clamp-3">
                {sharedData.text}
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={handleClose}
            className="flex-1"
            disabled={isUploading}
            data-testid="button-cancel-share"
          >
            Cancel
          </Button>
          <Button
            onClick={handleProcess}
            className="flex-1"
            disabled={isUploading || uploadComplete || (!hasImage && !hasUrl)}
            data-testid="button-process-share"
          >
            {isUploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : uploadComplete ? (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Done!
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Save Recipe
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

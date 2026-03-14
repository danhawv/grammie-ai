import { useState, useCallback, useRef, cloneElement, isValidElement } from 'react';
import { useConversation } from '@elevenlabs/react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Mic, MicOff, Phone, PhoneOff, Volume2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiRequest } from '@/lib/queryClient';

interface VoiceSession {
  token: string;
  expiresAt: string;
  userContext: {
    name: string;
    preferences: {
      allergies: string[];
      dietaryRestrictions: string[];
      dislikedIngredients: string[];
      cookingSkillLevel: string;
      cuisinePreferences: string[];
      householdSize: number;
      cookingGoals: string[];
      grammieNotes: string;
      unitSystem: string;
    };
  };
}

interface VoiceAssistantProps {
  mode?: 'general' | 'cooking';
  recipeContext?: {
    name: string;
    recipeId?: string;
    ingredients?: string[];
    instructions?: string[];
  };
  trigger?: React.ReactNode;
  className?: string;
}

export function VoiceAssistant({ 
  mode = 'general', 
  recipeContext,
  trigger,
  className 
}: VoiceAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Array<{ source: string; text: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const sessionTokenRef = useRef<string | null>(null);

  const conversation = useConversation({
    onConnect: () => {
      setError(null);
      setMessages(prev => [...prev, { source: 'system', text: 'Connected to Grammie' }]);
    },
    onDisconnect: () => {
      setMessages(prev => [...prev, { source: 'system', text: 'Call ended' }]);
      if (sessionTokenRef.current) {
        apiRequest('POST', '/api/voice/session/end', { token: sessionTokenRef.current }).catch(console.error);
        sessionTokenRef.current = null;
      }
    },
    onMessage: ({ message, source }) => {
      setMessages(prev => [...prev, { source, text: message }]);
    },
    onError: (err) => {
      console.error('Voice assistant error:', err);
      setError('Connection failed. Please try again.');
    },
  });

  const agentId = import.meta.env.VITE_ELEVENLABS_AGENT_ID;

  const handleStart = useCallback(async () => {
    if (!agentId) {
      setError('Voice assistant not configured');
      return;
    }

    setMessages([]);
    setError(null);

    try {
      const sessionResponse = await apiRequest('POST', '/api/voice/session/start', {
        mode,
        recipeId: recipeContext?.recipeId,
      });

      const session = await sessionResponse.json() as VoiceSession;
      sessionTokenRef.current = session.token;

      await conversation.startSession({
        agentId,
        connectionType: 'webrtc',
      });

      const prefs = session.userContext.preferences;
      let contextParts = [
        `User: ${session.userContext.name}`,
        `Session Token: ${session.token} (use this for API calls to perform actions)`,
        `Webhook Base URL: ${window.location.origin}/api/voice`,
      ];

      if (prefs.allergies?.length) {
        contextParts.push(`CRITICAL ALLERGIES (avoid these ingredients): ${prefs.allergies.join(', ')}`);
      }
      if (prefs.dietaryRestrictions?.length) {
        contextParts.push(`Dietary restrictions: ${prefs.dietaryRestrictions.join(', ')}`);
      }
      if (prefs.dislikedIngredients?.length) {
        contextParts.push(`Dislikes: ${prefs.dislikedIngredients.join(', ')}`);
      }
      if (prefs.cookingSkillLevel) {
        contextParts.push(`Cooking skill: ${prefs.cookingSkillLevel}`);
      }
      if (prefs.householdSize) {
        contextParts.push(`Household size: ${prefs.householdSize} people`);
      }
      if (prefs.grammieNotes) {
        contextParts.push(`Notes to remember: ${prefs.grammieNotes}`);
      }
      if (prefs.unitSystem) {
        contextParts.push(`Preferred units: ${prefs.unitSystem === 'metric' ? 'Metric' : 'US'}`);
      }

      if (mode === 'cooking' && recipeContext) {
        const instructionsText = recipeContext.instructions?.length 
          ? `Instructions: ${recipeContext.instructions.map((step, i) => `Step ${i + 1}: ${step}`).join('. ')}`
          : '';
        contextParts.push(
          `Currently cooking: ${recipeContext.name}`,
          `Ingredients: ${recipeContext.ingredients?.join(', ') || 'Not specified'}`,
          instructionsText,
          'Help with step-by-step guidance. Read steps aloud when asked.'
        );
      }

      contextParts.push(
        'You can perform actions for the user:',
        '- Add items to pantry: POST /api/voice/pantry/add with Bearer token',
        '- List pantry: POST /api/voice/pantry/list with Bearer token',
        '- Update preferences: POST /api/voice/preferences/update with Bearer token',
        '- Create recipe: POST /api/voice/recipe/create with Bearer token'
      );

      conversation.sendContextualUpdate(contextParts.join('\n'));
    } catch (err) {
      console.error('Failed to start conversation:', err);
      setError('Failed to connect. Please check your microphone permissions.');
    }
  }, [agentId, conversation, mode, recipeContext]);

  const handleEnd = useCallback(async () => {
    await conversation.endSession();
    if (sessionTokenRef.current) {
      try {
        await apiRequest('POST', '/api/voice/session/end', { token: sessionTokenRef.current });
      } catch (e) {
        console.error('Failed to end voice session:', e);
      }
      sessionTokenRef.current = null;
    }
  }, [conversation]);

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open && conversation.status === 'connected') {
      handleEnd();
    }
  };

  const isConnected = conversation.status === 'connected';
  const isConnecting = conversation.status === 'connecting';

  const renderTrigger = () => {
    if (trigger && isValidElement(trigger)) {
      return cloneElement(trigger as React.ReactElement<any>, {
        onClick: (e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          setIsOpen(true);
        }
      });
    }
    return (
      <Button 
        variant="outline" 
        size="sm"
        onClick={() => setIsOpen(true)}
        className={className}
        data-testid="button-ask-grammie"
      >
        <Mic className="w-4 h-4 mr-2" />
        Ask Grammie
      </Button>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <div className={className}>
        {renderTrigger()}
      </div>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mic className="w-5 h-5 text-primary" />
            {mode === 'cooking' ? 'Cooking Assistant' : 'Ask Grammie'}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-6 py-6">
          {mode === 'cooking' && recipeContext && (
            <div className="text-center text-sm text-muted-foreground">
              Cooking: <span className="font-medium text-foreground">{recipeContext.name}</span>
            </div>
          )}

          <div className="relative">
            <div 
              className={cn(
                "w-32 h-32 rounded-full flex items-center justify-center transition-all duration-300",
                isConnected 
                  ? conversation.isSpeaking 
                    ? "bg-primary/20 ring-4 ring-primary/40 animate-pulse" 
                    : "bg-primary/10 ring-2 ring-primary/20"
                  : "bg-muted"
              )}
            >
              {isConnecting ? (
                <Loader2 className="w-12 h-12 text-muted-foreground animate-spin" />
              ) : isConnected ? (
                conversation.isSpeaking ? (
                  <Volume2 className="w-12 h-12 text-primary animate-pulse" />
                ) : (
                  <Mic className="w-12 h-12 text-primary" />
                )
              ) : (
                <MicOff className="w-12 h-12 text-muted-foreground" />
              )}
            </div>

            {isConnected && (
              <div className="absolute -bottom-2 left-1/2 -translate-x-1/2">
                <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-full">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  {conversation.isSpeaking ? 'Grammie is speaking...' : 'Listening...'}
                </span>
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm text-destructive text-center">{error}</p>
          )}

          <div className="flex gap-3">
            {!isConnected ? (
              <Button 
                size="lg" 
                onClick={handleStart}
                disabled={isConnecting}
                className="gap-2"
                data-testid="button-start-call"
              >
                {isConnecting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Phone className="w-4 h-4" />
                    Start Call
                  </>
                )}
              </Button>
            ) : (
              <Button 
                size="lg" 
                variant="destructive"
                onClick={handleEnd}
                className="gap-2"
                data-testid="button-end-call"
              >
                <PhoneOff className="w-4 h-4" />
                End Call
              </Button>
            )}
          </div>

          {messages.length > 0 && (
            <div className="w-full max-h-40 overflow-y-auto space-y-2 text-sm">
              {messages.slice(-5).map((msg, i) => (
                <div 
                  key={i} 
                  className={cn(
                    "p-2 rounded-lg",
                    msg.source === 'agent' 
                      ? "bg-primary/10 text-foreground" 
                      : msg.source === 'user'
                      ? "bg-muted text-foreground ml-4"
                      : "text-muted-foreground text-center text-xs"
                  )}
                >
                  {msg.source !== 'system' && (
                    <span className="font-medium capitalize">{msg.source}: </span>
                  )}
                  {msg.text}
                </div>
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground text-center max-w-xs">
            {mode === 'cooking' 
              ? 'Ask about the recipe, request the next step, or get substitution suggestions.'
              : 'Ask any cooking question - recipes, techniques, substitutions, or meal planning.'
            }
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

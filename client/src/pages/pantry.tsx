import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Plus, Camera, Trash2, Package, ScanLine, Loader2, ChevronRight, Pencil, ShoppingCart, Scale, ChefHat, Mic, MicOff, Square, CheckCircle2, AlertTriangle, Star, CalendarDays, ArrowUpDown } from 'lucide-react';
import type { PantryItem, PantryScanSession, PantryStaple } from '@shared/schema';
import { Link } from 'wouter';
import grammieImage from "@assets/image_1763329917086.png";

const PANTRY_CATEGORIES = [
  'produce', 'dairy', 'meat', 'seafood', 'bakery', 'frozen', 
  'canned', 'dry-goods', 'condiments', 'beverages', 'snacks', 'other'
] as const;

const US_UNIT_OPTIONS = [
  { value: '', label: 'No unit' },
  { value: 'oz', label: 'Ounces (oz)' },
  { value: 'lb', label: 'Pounds (lb)' },
  { value: 'fl oz', label: 'Fluid oz' },
  { value: 'cup', label: 'Cups' },
  { value: 'tbsp', label: 'Tablespoons' },
  { value: 'tsp', label: 'Teaspoons' },
  { value: 'pcs', label: 'Pieces' },
  { value: 'bunch', label: 'Bunch' },
  { value: 'can', label: 'Can' },
  { value: 'jar', label: 'Jar' },
  { value: 'bag', label: 'Bag' },
  { value: 'box', label: 'Box' },
  { value: 'bottle', label: 'Bottle' },
  { value: 'pack', label: 'Pack' },
] as const;

const METRIC_UNIT_OPTIONS = [
  { value: '', label: 'No unit' },
  { value: 'g', label: 'Grams (g)' },
  { value: 'kg', label: 'Kilograms (kg)' },
  { value: 'ml', label: 'Milliliters (ml)' },
  { value: 'L', label: 'Liters (L)' },
  { value: 'pcs', label: 'Pieces' },
  { value: 'bunch', label: 'Bunch' },
  { value: 'can', label: 'Can' },
  { value: 'jar', label: 'Jar' },
  { value: 'bag', label: 'Bag' },
  { value: 'box', label: 'Box' },
  { value: 'bottle', label: 'Bottle' },
  { value: 'pack', label: 'Pack' },
] as const;

// Smart expiration defaults by category (in days)
const EXPIRATION_DEFAULTS: Record<string, number> = {
  produce: 5, dairy: 10, meat: 3, seafood: 2, bakery: 5,
  frozen: 90, canned: 365, 'dry-goods': 180,
};

// Get expiration status for display
function getExpirationStatus(expiresAt: string | Date | null | undefined): {
  label: string;
  variant: 'default' | 'warning' | 'urgent' | 'expired' | 'ok';
  dateText: string | null;
} {
  if (!expiresAt) return { label: 'In Stock', variant: 'ok', dateText: null };
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const exp = new Date(expiresAt);
  exp.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const dateStr = exp.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  if (diffDays < 0) return { label: 'Expired', variant: 'expired', dateText: `Expired ${Math.abs(diffDays)}d ago` };
  if (diffDays <= 2) return { label: 'Expiring', variant: 'urgent', dateText: `Expires ${dateStr}` };
  if (diffDays <= 5) return { label: 'Expires Soon', variant: 'warning', dateText: `Expires ${dateStr}` };
  return { label: 'In Stock', variant: 'ok', dateText: `Expires ${dateStr}` };
}

const EXPIRATION_BADGE_STYLES = {
  ok: 'bg-green-500/10 text-green-600 border-green-200',
  warning: 'bg-amber-500/10 text-amber-600 border-amber-200',
  urgent: 'bg-orange-500/10 text-orange-600 border-orange-200',
  expired: 'bg-red-500/10 text-red-600 border-red-200',
  default: 'bg-green-500/10 text-green-600 border-green-200',
};

// Format quantity - round to sensible precision
const formatQuantity = (qty: number | null | undefined): string => {
  if (qty === null || qty === undefined) return '';
  if (Number.isInteger(qty)) return qty.toString();
  // Round to 1 decimal place, remove trailing zeros
  const rounded = Math.round(qty * 10) / 10;
  return rounded.toString();
};

export default function PantryPage() {
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isScanDialogOpen, setIsScanDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<PantryItem | null>(null);
  const [unitSystem, setUnitSystem] = useState<'us' | 'metric'>('us');
  
  // Add form state
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState<string>('other');
  const [newItemQuantity, setNewItemQuantity] = useState('');
  const [newItemUnit, setNewItemUnit] = useState('');
  
  // Edit form state
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState<string>('other');
  const [editQuantity, setEditQuantity] = useState('');
  const [editUnit, setEditUnit] = useState('');

  // Expiration date state
  const [newItemExpires, setNewItemExpires] = useState('');
  const [editExpires, setEditExpires] = useState('');

  // Sort/filter state
  const [sortMode, setSortMode] = useState<'category' | 'expiration'>('category');
  const [showExpiringOnly, setShowExpiringOnly] = useState(false);
  const [dismissedBanner, setDismissedBanner] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isVoiceProcessing, setIsVoiceProcessing] = useState(false);
  const [voiceResult, setVoiceResult] = useState<{ items: any[]; message: string } | null>(null);
  const [speechSupported, setSpeechSupported] = useState(true);
  const recognitionRef = useRef<any>(null);
  
  // Get unit options based on selected system
  const unitOptions = unitSystem === 'us' ? US_UNIT_OPTIONS : METRIC_UNIT_OPTIONS;
  
  // Load user preference
  const { data: authStatus } = useQuery<{ user: { preferences?: { unitSystem?: 'metric' | 'us' } } }>({
    queryKey: ['/api/auth/status'],
  });
  
  useEffect(() => {
    if (authStatus?.user?.preferences?.unitSystem) {
      setUnitSystem(authStatus.user.preferences.unitSystem);
    }
  }, [authStatus]);

  const { data: pantryItems, isLoading } = useQuery<PantryItem[]>({
    queryKey: ['/api/pantry/items'],
  });

  const { data: scanSessions } = useQuery<PantryScanSession[]>({
    queryKey: ['/api/pantry/scans'],
  });

  const addItemMutation = useMutation({
    mutationFn: async (item: { name: string; category: string; quantity?: number; unit?: string }) => {
      return apiRequest('POST', '/api/pantry/items', item);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/pantry/items'] });
      queryClient.invalidateQueries({ queryKey: ['/api/pantry'] });
      setIsAddDialogOpen(false);
      setNewItemName('');
      setNewItemCategory('other');
      setNewItemQuantity('');
      setNewItemUnit('');
      setNewItemExpires('');
      toast({ title: 'Item added', description: 'Pantry item added successfully' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to add item', variant: 'destructive' });
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; name?: string; category?: string; quantity?: number | null; unit?: string | null }) => {
      return apiRequest('PATCH', `/api/pantry/items/${id}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/pantry/items'] });
      queryClient.invalidateQueries({ queryKey: ['/api/pantry'] });
      setIsEditDialogOpen(false);
      setEditingItem(null);
      toast({ title: 'Item updated', description: 'Pantry item updated successfully' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to update item', variant: 'destructive' });
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/pantry/items/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/pantry/items'] });
      queryClient.invalidateQueries({ queryKey: ['/api/pantry'] });
      toast({ title: 'Item removed', description: 'Pantry item deleted' });
    },
  });

  const scanPantryMutation = useMutation({
    mutationFn: async (imageBase64: string) => {
      return apiRequest('POST', '/api/pantry/scan', { image: imageBase64 });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/pantry/items'] });
      queryClient.invalidateQueries({ queryKey: ['/api/pantry'] });
      queryClient.invalidateQueries({ queryKey: ['/api/pantry/scans'] });
      setIsScanDialogOpen(false);
      setSelectedImage(null);
      toast({ 
        title: 'Scan complete', 
        description: `Found ${data.itemsAdded || 0} items in your pantry` 
      });
    },
    onError: () => {
      toast({ title: 'Scan failed', description: 'Could not analyze the image', variant: 'destructive' });
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setSelectedImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleScanSubmit = () => {
    if (!selectedImage) return;
    const base64Data = selectedImage.split(',')[1];
    scanPantryMutation.mutate(base64Data);
  };

  const handleAddItem = () => {
    if (!newItemName.trim()) return;
    addItemMutation.mutate({
      name: newItemName.trim(),
      category: newItemCategory,
      quantity: newItemQuantity ? parseFloat(newItemQuantity) : undefined,
      unit: newItemUnit || undefined,
      expiresAt: newItemExpires ? new Date(newItemExpires).toISOString() : undefined,
    } as any);
  };

  const startRecording = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechSupported(false);
      toast({ title: 'Not supported', description: 'Voice recognition is not available in your browser. Try Chrome or Safari.', variant: 'destructive' });
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let finalTranscript = '';

    recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript + ' ';
        } else {
          interim += result[0].transcript;
        }
      }
      setTranscript(finalTranscript + interim);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      if (event.error === 'not-allowed') {
        toast({ title: 'Microphone blocked', description: 'Please allow microphone access in your browser settings.', variant: 'destructive' });
      }
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    setTranscript('');
    setVoiceResult(null);
    recognition.start();
    setIsRecording(true);
  }, [toast]);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsRecording(false);
  }, []);

  const submitVoiceTranscript = useCallback(async () => {
    if (!transcript.trim()) {
      toast({ title: 'Nothing to process', description: 'Please speak your ingredients first.', variant: 'destructive' });
      return;
    }

    setIsVoiceProcessing(true);
    try {
      const response = await apiRequest('POST', '/api/pantry/voice', { transcript: transcript.trim() });
      const data = await response.json();
      setVoiceResult(data);
      queryClient.invalidateQueries({ queryKey: ['/api/pantry/items'] });
      queryClient.invalidateQueries({ queryKey: ['/api/pantry'] });
      toast({ title: 'Items added', description: data.message });
    } catch (error) {
      console.error('Voice processing error:', error);
      toast({ title: 'Processing failed', description: 'Could not parse your ingredients. Please try again.', variant: 'destructive' });
    } finally {
      setIsVoiceProcessing(false);
    }
  }, [transcript, toast]);

  const resetVoice = useCallback(() => {
    setTranscript('');
    setVoiceResult(null);
    setIsVoiceProcessing(false);
  }, []);

  const handleEditItem = (item: PantryItem) => {
    setEditingItem(item);
    setEditName(item.name);
    setEditCategory(item.category || 'other');
    setEditQuantity(item.quantity?.toString() || '');
    setEditUnit(item.unit || '');
    setEditExpires(item.expiresAt ? new Date(item.expiresAt).toISOString().split('T')[0] : '');
    setIsEditDialogOpen(true);
  };

  const handleSaveEdit = () => {
    if (!editingItem || !editName.trim()) return;
    updateItemMutation.mutate({
      id: editingItem.id,
      name: editName.trim(),
      category: editCategory,
      quantity: editQuantity ? parseFloat(editQuantity) : null,
      unit: editUnit || null,
      expiresAt: editExpires ? new Date(editExpires).toISOString() : null,
    } as any);
  };

  // Count items expiring soon (within 3 days) for banner
  const expiringItems = pantryItems?.filter((item) => {
    if (!item.expiresAt) return false;
    const status = getExpirationStatus(item.expiresAt);
    return status.variant === 'expired' || status.variant === 'urgent' || status.variant === 'warning';
  }) || [];

  // Filter items if "Expiring Soon" filter is active
  const filteredItems = showExpiringOnly
    ? pantryItems?.filter((item) => {
        if (!item.expiresAt) return false;
        const status = getExpirationStatus(item.expiresAt);
        return status.variant !== 'ok';
      }) || []
    : pantryItems || [];

  // Group and sort items
  const groupedItems = sortMode === 'expiration'
    ? { 'By Expiration': [...filteredItems].sort((a, b) => {
        if (!a.expiresAt && !b.expiresAt) return a.name.localeCompare(b.name);
        if (!a.expiresAt) return 1;
        if (!b.expiresAt) return -1;
        return new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
      }) }
    : filteredItems.reduce((acc, item) => {
        const category = item.category || 'other';
        if (!acc[category]) acc[category] = [];
        acc[category].push(item);
        return acc;
      }, {} as Record<string, PantryItem[]>);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            <p className="text-muted-foreground">Loading pantry...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-bold" data-testid="text-pantry-title">My Pantry</h1>
          </div>
          <div className="flex items-center gap-1.5">
            <Link href="/what-can-i-make">
              <Button variant="default" size="sm" data-testid="button-what-can-i-make">
                <ChefHat className="w-4 h-4 mr-1" />
                What Can I Make?
              </Button>
            </Link>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setUnitSystem(unitSystem === 'us' ? 'metric' : 'us')}
              title={unitSystem === 'us' ? 'Switch to Metric' : 'Switch to US'}
              data-testid="button-toggle-units"
            >
              <Scale className="w-4 h-4" />
            </Button>
            <Dialog open={isScanDialogOpen} onOpenChange={setIsScanDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8" title="Scan pantry with AI" data-testid="button-scan-pantry">
                  <Camera className="w-4 h-4" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <ScanLine className="w-5 h-5" />
                    AI Pantry Scan
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Take a photo of your fridge or pantry shelves. Our AI will identify items and add them to your inventory.
                  </p>
                  
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handleFileSelect}
                    data-testid="input-scan-file"
                  />
                  
                  {selectedImage ? (
                    <div className="space-y-4">
                      <img 
                        src={selectedImage} 
                        alt="Pantry scan preview" 
                        className="w-full h-48 object-cover rounded-lg"
                      />
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          className="flex-1"
                          onClick={() => {
                            setSelectedImage(null);
                            if (fileInputRef.current) fileInputRef.current.value = '';
                          }}
                        >
                          Retake
                        </Button>
                        <Button
                          className="flex-1"
                          onClick={handleScanSubmit}
                          disabled={scanPantryMutation.isPending}
                          data-testid="button-submit-scan"
                        >
                          {scanPantryMutation.isPending ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Analyzing...
                            </>
                          ) : (
                            'Analyze'
                          )}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      className="w-full h-32 border-dashed"
                      onClick={() => fileInputRef.current?.click()}
                      data-testid="button-capture-photo"
                    >
                      <div className="flex flex-col items-center gap-2">
                        <Camera className="w-8 h-8 text-muted-foreground" />
                        <span>Tap to take photo</span>
                      </div>
                    </Button>
                  )}
                </div>
              </DialogContent>
            </Dialog>

            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={isRecording ? stopRecording : startRecording}
              disabled={!speechSupported || isVoiceProcessing}
              title={isRecording ? 'Stop recording' : 'Add items by voice'}
              data-testid="button-voice-pantry"
            >
              {isRecording ? (
                <Square className="w-4 h-4 text-red-500" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </Button>

            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-add-item">
                  <Plus className="w-4 h-4 mr-1" />
                  Add
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Pantry Item</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Input
                      placeholder="Item name"
                      value={newItemName}
                      onChange={(e) => setNewItemName(e.target.value)}
                      data-testid="input-item-name"
                    />
                  </div>
                  <div>
                    <Select value={newItemCategory} onValueChange={setNewItemCategory}>
                      <SelectTrigger data-testid="select-category">
                        <SelectValue placeholder="Category" />
                      </SelectTrigger>
                      <SelectContent>
                        {PANTRY_CATEGORIES.map((cat) => (
                          <SelectItem key={cat} value={cat}>
                            {cat.charAt(0).toUpperCase() + cat.slice(1).replace('-', ' ')}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      placeholder="Quantity"
                      value={newItemQuantity}
                      onChange={(e) => setNewItemQuantity(e.target.value)}
                      className="flex-1"
                      data-testid="input-quantity"
                    />
                    <Select value={newItemUnit} onValueChange={setNewItemUnit}>
                      <SelectTrigger className="w-32" data-testid="select-unit">
                        <SelectValue placeholder="Unit" />
                      </SelectTrigger>
                      <SelectContent>
                        {unitOptions.map((unit) => (
                          <SelectItem key={unit.value || 'none'} value={unit.value || 'none'}>
                            {unit.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground flex items-center gap-1 mb-1">
                      <CalendarDays className="w-3.5 h-3.5" /> Expires
                      {newItemCategory && EXPIRATION_DEFAULTS[newItemCategory] && !newItemExpires && (
                        <button
                          type="button"
                          className="text-xs text-primary hover:underline ml-1"
                          onClick={() => {
                            const d = new Date();
                            d.setDate(d.getDate() + EXPIRATION_DEFAULTS[newItemCategory]);
                            setNewItemExpires(d.toISOString().split('T')[0]);
                          }}
                        >
                          (suggest ~{EXPIRATION_DEFAULTS[newItemCategory]}d)
                        </button>
                      )}
                    </label>
                    <Input
                      type="date"
                      value={newItemExpires}
                      onChange={(e) => setNewItemExpires(e.target.value)}
                    />
                  </div>
                  <Button
                    className="w-full"
                    onClick={handleAddItem}
                    disabled={!newItemName.trim() || addItemMutation.isPending}
                    data-testid="button-confirm-add"
                  >
                    {addItemMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      'Add to Pantry'
                    )}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Edit Dialog */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Pantry Item</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Input
                  placeholder="Item name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  data-testid="input-edit-name"
                />
              </div>
              <div>
                <Select value={editCategory} onValueChange={setEditCategory}>
                  <SelectTrigger data-testid="select-edit-category">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    {PANTRY_CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat.charAt(0).toUpperCase() + cat.slice(1).replace('-', ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="Quantity"
                  value={editQuantity}
                  onChange={(e) => setEditQuantity(e.target.value)}
                  className="flex-1"
                  data-testid="input-edit-quantity"
                />
                <Select value={editUnit || 'none'} onValueChange={(v) => setEditUnit(v === 'none' ? '' : v)}>
                  <SelectTrigger className="w-32" data-testid="select-edit-unit">
                    <SelectValue placeholder="Unit" />
                  </SelectTrigger>
                  <SelectContent>
                    {unitOptions.map((unit) => (
                      <SelectItem key={unit.value || 'none'} value={unit.value || 'none'}>
                        {unit.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm text-muted-foreground flex items-center gap-1 mb-1">
                  <CalendarDays className="w-3.5 h-3.5" /> Expires
                </label>
                <Input
                  type="date"
                  value={editExpires}
                  onChange={(e) => setEditExpires(e.target.value)}
                />
              </div>
              <Button
                className="w-full"
                onClick={handleSaveEdit}
                disabled={!editName.trim() || updateItemMutation.isPending}
                data-testid="button-save-edit"
              >
                {updateItemMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Save Changes'
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {(isRecording || transcript || voiceResult) && (
          <Card className="mb-6 border-primary/20" data-testid="card-voice-recording">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <img src={grammieImage} alt="Grammie" className="w-10 h-10 rounded-full object-cover shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  {isRecording && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="relative flex h-3 w-3">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                        </span>
                        <p className="text-sm font-medium">Listening... tell Grammie what you have</p>
                      </div>
                      <p className="text-sm text-muted-foreground italic">
                        {transcript || 'Start speaking your ingredients...'}
                      </p>
                    </div>
                  )}

                  {!isRecording && transcript && !voiceResult && (
                    <div className="space-y-3">
                      <p className="text-sm font-medium">Here's what I heard:</p>
                      <p className="text-sm text-muted-foreground bg-muted rounded-md p-3" data-testid="text-voice-transcript">
                        {transcript}
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={submitVoiceTranscript}
                          disabled={isVoiceProcessing}
                          data-testid="button-submit-voice"
                        >
                          {isVoiceProcessing ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Adding to pantry...
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="w-4 h-4 mr-2" />
                              Add to Pantry
                            </>
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={startRecording}
                          disabled={isVoiceProcessing}
                          data-testid="button-redo-voice"
                        >
                          <Mic className="w-4 h-4 mr-2" />
                          Try Again
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={resetVoice}
                          disabled={isVoiceProcessing}
                          data-testid="button-cancel-voice"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}

                  {voiceResult && (
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-green-600 dark:text-green-400" data-testid="text-voice-result">
                        {voiceResult.message}
                      </p>
                      {voiceResult.items && voiceResult.items.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {voiceResult.items.map((item: any, i: number) => (
                            <Badge key={i} variant="secondary" className="text-xs">
                              {item.name}
                              {item.quantity ? ` (${item.quantity}${item.unit ? ' ' + item.unit : ''})` : ''}
                            </Badge>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => { resetVoice(); startRecording(); }}
                          data-testid="button-voice-add-more"
                        >
                          <Mic className="w-4 h-4 mr-2" />
                          Add More
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={resetVoice}
                          data-testid="button-voice-done"
                        >
                          Done
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Expiration banner */}
        {expiringItems.length > 0 && !dismissedBanner && (
          <div className="mb-4 p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
                {expiringItems.length} item{expiringItems.length > 1 ? 's' : ''} expiring soon
              </span>
              <button
                className="text-xs text-amber-600 hover:underline"
                onClick={() => setShowExpiringOnly(true)}
              >
                Show
              </button>
            </div>
            <button
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setDismissedBanner(true)}
            >
              Dismiss
            </button>
          </div>
        )}

        <Tabs defaultValue="inventory" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-4">
            <TabsTrigger value="inventory" data-testid="tab-inventory">Inventory</TabsTrigger>
            <TabsTrigger value="staples" data-testid="tab-staples">Staples</TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-history">Scan History</TabsTrigger>
          </TabsList>

          <TabsContent value="inventory">
            {/* Sort & Filter controls */}
            {pantryItems && pantryItems.length > 0 && (
              <div className="flex items-center gap-2 mb-4">
                <Button
                  variant={sortMode === 'category' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSortMode('category')}
                >
                  By Category
                </Button>
                <Button
                  variant={sortMode === 'expiration' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSortMode('expiration')}
                >
                  <ArrowUpDown className="w-3.5 h-3.5 mr-1" />
                  By Expiration
                </Button>
                {expiringItems.length > 0 && (
                  <Button
                    variant={showExpiringOnly ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setShowExpiringOnly(!showExpiringOnly)}
                    className={showExpiringOnly ? 'bg-amber-600 hover:bg-amber-700' : ''}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 mr-1" />
                    Expiring ({expiringItems.length})
                  </Button>
                )}
              </div>
            )}
            {Object.keys(groupedItems).length === 0 ? (
              <div className="text-center py-16">
                <Package className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">Your pantry is empty</p>
                <p className="text-sm text-muted-foreground/70 mt-1">
                  Add items manually or scan your fridge
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {Object.entries(groupedItems).map(([category, items]) => (
                  <div key={category}>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 pb-2 border-b">
                      {category.replace('-', ' ')}
                    </div>
                    <div className="space-y-2">
                      {items.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center gap-3 py-3 px-3 rounded-lg bg-card border hover-elevate cursor-pointer"
                          onClick={() => handleEditItem(item)}
                          data-testid={`pantry-item-${item.id}`}
                        >
                          <div className="flex-1">
                            <p className="font-medium">{item.emoji ? `${item.emoji} ` : ''}{item.name}</p>
                            <div className="flex items-center gap-2">
                              {(item.quantity || item.unit) && (
                                <p className="text-sm text-muted-foreground">
                                  {formatQuantity(item.quantity)} {item.unit || ''}
                                </p>
                              )}
                              {(() => {
                                const status = getExpirationStatus(item.expiresAt);
                                return status.dateText ? (
                                  <p className={`text-xs ${status.variant === 'expired' ? 'text-red-500' : status.variant === 'urgent' ? 'text-orange-500' : status.variant === 'warning' ? 'text-amber-500' : 'text-muted-foreground'}`}>
                                    {status.dateText}
                                  </p>
                                ) : null;
                              })()}
                            </div>
                          </div>
                          {(() => {
                            const status = getExpirationStatus(item.expiresAt);
                            return (
                              <Badge variant="outline" className={EXPIRATION_BADGE_STYLES[status.variant]}>
                                {status.label}
                              </Badge>
                            );
                          })()}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditItem(item);
                            }}
                            data-testid={`edit-${item.id}`}
                          >
                            <Pencil className="w-4 h-4 text-muted-foreground" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteItemMutation.mutate(item.id);
                            }}
                            data-testid={`delete-${item.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-muted-foreground" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="staples">
            <StaplesTab pantryItems={pantryItems || []} />
          </TabsContent>

          <TabsContent value="history">
            {!scanSessions || scanSessions.length === 0 ? (
              <div className="text-center py-16">
                <ScanLine className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">No scan history yet</p>
                <p className="text-sm text-muted-foreground/70 mt-1">
                  Use the Scan button to analyze your pantry
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {scanSessions.map((session) => (
                  <Card key={session.id} data-testid={`scan-${session.id}`}>
                    <CardContent className="py-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">
                            {new Date(session.createdAt).toLocaleDateString()} at{' '}
                            {new Date(session.createdAt).toLocaleTimeString()}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {session.extractedItems?.length || 0} items detected
                          </p>
                        </div>
                        <Badge variant={session.status === 'ready' ? 'default' : 'secondary'}>
                          {session.status}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        <div className="mt-8 pt-6 border-t">
          <Link href="/grocery-list">
            <Button variant="outline" className="w-full" data-testid="link-grocery-list">
              <ShoppingCart className="w-4 h-4 mr-2" />
              View Grocery List
              <ChevronRight className="w-4 h-4 ml-auto" />
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Staples Tab Component
// ============================================================================
function StaplesTab({ pantryItems }: { pantryItems: PantryItem[] }) {
  const { toast } = useToast();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('other');
  const [minQuantity, setMinQuantity] = useState('');
  const [preferredUnit, setPreferredUnit] = useState('');

  const { data: staples, isLoading } = useQuery<PantryStaple[]>({
    queryKey: ['/api/pantry/staples'],
  });

  const { data: restockItems } = useQuery<{ staple: PantryStaple; currentQuantity: number | null; needed: boolean }[]>({
    queryKey: ['/api/pantry/restock'],
  });

  const addStapleMutation = useMutation({
    mutationFn: async (data: { name: string; category?: string; minQuantity?: number; preferredUnit?: string }) => {
      return apiRequest('POST', '/api/pantry/staples', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/pantry/staples'] });
      queryClient.invalidateQueries({ queryKey: ['/api/pantry/restock'] });
      setIsAddOpen(false);
      setName(''); setCategory('other'); setMinQuantity(''); setPreferredUnit('');
      toast({ title: 'Staple added' });
    },
    onError: () => toast({ title: 'Error', description: 'Failed to add staple', variant: 'destructive' }),
  });

  const deleteStapleMutation = useMutation({
    mutationFn: async (id: string) => apiRequest('DELETE', `/api/pantry/staples/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/pantry/staples'] });
      queryClient.invalidateQueries({ queryKey: ['/api/pantry/restock'] });
      toast({ title: 'Staple removed' });
    },
  });

  const restockMutation = useMutation({
    mutationFn: async () => apiRequest('POST', '/api/pantry/restock/add-to-grocery'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/grocery-list/by-aisle'] });
      toast({ title: 'Added to grocery list', description: 'Low-stock staples added to your grocery list' });
    },
    onError: () => toast({ title: 'Error', description: 'Failed to add to grocery list', variant: 'destructive' }),
  });

  const needsRestock = restockItems?.filter(r => r.needed) || [];

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }

  return (
    <div>
      {/* Restock banner */}
      {needsRestock.length > 0 && (
        <div className="mb-4 p-3 rounded-lg border border-orange-200 bg-orange-50 dark:bg-orange-950/20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-orange-600" />
            <span className="text-sm font-medium text-orange-800 dark:text-orange-200">
              {needsRestock.length} staple{needsRestock.length > 1 ? 's' : ''} need restocking
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => restockMutation.mutate()}
            disabled={restockMutation.isPending}
          >
            {restockMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <ShoppingCart className="w-3.5 h-3.5 mr-1" />}
            Add to Grocery List
          </Button>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">Items you always want stocked</p>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Add Staple</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Staple Item</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <Input placeholder="Item name (e.g., Eggs)" value={name} onChange={(e) => setName(e.target.value)} />
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
                <SelectContent>
                  {PANTRY_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>{cat.charAt(0).toUpperCase() + cat.slice(1).replace('-', ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <Input type="number" placeholder="Min quantity" value={minQuantity} onChange={(e) => setMinQuantity(e.target.value)} className="flex-1" />
                <Input placeholder="Unit (e.g., pcs)" value={preferredUnit} onChange={(e) => setPreferredUnit(e.target.value)} className="w-24" />
              </div>
              <Button
                className="w-full"
                onClick={() => addStapleMutation.mutate({
                  name: name.trim(),
                  category,
                  minQuantity: minQuantity ? parseFloat(minQuantity) : undefined,
                  preferredUnit: preferredUnit || undefined,
                })}
                disabled={!name.trim() || addStapleMutation.isPending}
              >
                {addStapleMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add Staple'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {!staples || staples.length === 0 ? (
        <div className="text-center py-16">
          <Star className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">No staples yet</p>
          <p className="text-sm text-muted-foreground/70 mt-1">Add items you always want to keep in stock</p>
        </div>
      ) : (
        <div className="space-y-2">
          {staples.map((staple) => {
            const restock = restockItems?.find(r => r.staple.id === staple.id);
            const isLow = restock?.needed;
            const currentQty = restock?.currentQuantity;
            return (
              <div key={staple.id} className="flex items-center gap-3 py-3 px-3 rounded-lg bg-card border">
                <div className="flex-1">
                  <p className="font-medium">{staple.emoji ? `${staple.emoji} ` : ''}{staple.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Min: {staple.minQuantity || '—'} {staple.preferredUnit || ''}
                    {currentQty !== null && currentQty !== undefined && (
                      <> · Have: {currentQty} {staple.preferredUnit || ''}</>
                    )}
                  </p>
                </div>
                {isLow ? (
                  <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-200">
                    {currentQty === null || currentQty === undefined ? 'Out' : 'Low'}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-200">
                    ✓ Stocked
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => deleteStapleMutation.mutate(staple.id)}
                >
                  <Trash2 className="w-4 h-4 text-muted-foreground" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

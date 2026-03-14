import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  FileText,
  Image,
  Loader2,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  BookOpen,
  Layers,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import type { PrintLayoutData } from "@shared/schema";

interface PreflightIssue {
  type: 'error' | 'warning' | 'info';
  category: string;
  message: string;
  recipeId?: string;
  recipeName?: string;
}

interface PreflightStats {
  totalRecipes: number;
  estimatedPages: number;
  recipesWithImages: number;
  recipesWithoutImages: number;
  lowQualityImages?: number;
  pageSize?: string;
  templateStyle?: string;
  minPages?: number;
  maxPages?: number;
}

interface PreflightResult {
  status: 'ready' | 'warnings' | 'error';
  message: string;
  issues: PreflightIssue[];
  stats: PreflightStats;
}

interface PreflightCheckPanelProps {
  cookbookId: number;
  layoutData: PrintLayoutData;
  templateStyle: string;
  onPreflightComplete?: (result: PreflightResult) => void;
}

export function PreflightCheckPanel({ cookbookId, layoutData, templateStyle, onPreflightComplete }: PreflightCheckPanelProps) {
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['error', 'warning']));

  // Reset result when layout changes significantly
  useEffect(() => {
    setResult(null);
  }, [layoutData.sections.length, layoutData.sections.reduce((sum, s) => sum + s.recipeIds.length, 0)]);

  const preflightMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/cookbooks/${cookbookId}/preflight`, {
        layoutData,
        templateStyle
      });
      return response.json();
    },
    onSuccess: (data: PreflightResult) => {
      setResult(data);
      onPreflightComplete?.(data);
    },
  });

  const hasRecipes = layoutData.sections.some(s => s.recipeIds.length > 0);

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'ready':
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case 'warnings':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case 'error':
        return <XCircle className="h-5 w-5 text-destructive" />;
      default:
        return <Info className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getIssueIcon = (type: string) => {
    switch (type) {
      case 'error':
        return <XCircle className="h-4 w-4 text-destructive flex-shrink-0" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0" />;
      case 'info':
        return <Info className="h-4 w-4 text-blue-500 flex-shrink-0" />;
      default:
        return null;
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'image':
        return <Image className="h-4 w-4" />;
      case 'content':
        return <FileText className="h-4 w-4" />;
      case 'layout':
        return <Layers className="h-4 w-4" />;
      case 'pages':
        return <BookOpen className="h-4 w-4" />;
      default:
        return <Info className="h-4 w-4" />;
    }
  };

  const groupedIssues = result?.issues.reduce((acc, issue) => {
    if (!acc[issue.type]) acc[issue.type] = [];
    acc[issue.type].push(issue);
    return acc;
  }, {} as Record<string, PreflightIssue[]>) || {};

  const issueTypeLabels: Record<string, { label: string; color: string }> = {
    error: { label: 'Errors', color: 'destructive' },
    warning: { label: 'Warnings', color: 'secondary' },
    info: { label: 'Suggestions', color: 'secondary' },
  };

  return (
    <Card data-testid="preflight-check-panel">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-lg">Preflight Check</CardTitle>
            <CardDescription>Verify your cookbook is print-ready</CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => preflightMutation.mutate()}
            disabled={!hasRecipes || preflightMutation.isPending}
            data-testid="button-run-preflight"
          >
            {preflightMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            {result ? 'Re-check' : 'Run Check'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!hasRecipes && (
          <div className="text-center py-6 text-muted-foreground">
            <Info className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Add recipes to your cookbook to run preflight check</p>
          </div>
        )}

        {hasRecipes && !result && !preflightMutation.isPending && (
          <div className="text-center py-6 text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Click "Run Check" to verify your cookbook</p>
          </div>
        )}

        {preflightMutation.isPending && (
          <div className="text-center py-6">
            <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Analyzing recipes...</p>
          </div>
        )}

        {result && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50" data-testid="preflight-status">
              {getStatusIcon(result.status)}
              <div className="flex-1">
                <p className="font-medium">{result.message}</p>
                <p className="text-sm text-muted-foreground">
                  {result.stats.totalRecipes} recipes, ~{result.stats.estimatedPages} pages
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2 p-2 rounded bg-muted/30">
                <Image className="h-4 w-4 text-muted-foreground" />
                <span>{result.stats.recipesWithImages} with images</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded bg-muted/30">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span>{result.stats.recipesWithoutImages} without</span>
              </div>
            </div>

            {result.issues.length > 0 && (
              <ScrollArea className="h-[200px] pr-2">
                <div className="space-y-3">
                  {(['error', 'warning', 'info'] as const).map(type => {
                    const issues = groupedIssues[type] || [];
                    if (issues.length === 0) return null;

                    const { label, color } = issueTypeLabels[type];
                    const isExpanded = expandedCategories.has(type);

                    return (
                      <Collapsible
                        key={type}
                        open={isExpanded}
                        onOpenChange={() => toggleCategory(type)}
                      >
                        <CollapsibleTrigger className="flex items-center justify-between w-full p-2 rounded hover-elevate">
                          <div className="flex items-center gap-2">
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                            <span className="font-medium text-sm">{label}</span>
                            <Badge variant={color as any} className="text-xs">
                              {issues.length}
                            </Badge>
                          </div>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="space-y-2 mt-2 pl-6">
                            {issues.map((issue, idx) => (
                              <div
                                key={idx}
                                className="flex items-start gap-2 text-sm p-2 rounded bg-muted/30"
                                data-testid={`preflight-issue-${type}-${idx}`}
                              >
                                {getIssueIcon(issue.type)}
                                <div className="flex-1 min-w-0">
                                  <p className="text-foreground">{issue.message}</p>
                                  {issue.recipeName && (
                                    <Link
                                      href={`/recipe/${issue.recipeId}`}
                                      className="text-xs text-primary hover:underline"
                                    >
                                      {issue.recipeName}
                                    </Link>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  })}
                </div>
              </ScrollArea>
            )}

            {result.issues.length === 0 && result.status === 'ready' && (
              <div className="text-center py-4 text-muted-foreground">
                <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
                <p className="text-sm">All checks passed! Your cookbook is ready.</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import { useState } from "react";
import { useAiAutomation, type AiRecommendation } from "@/hooks/useAiAutomation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Brain,
  Zap,
  RefreshCw,
  Cpu,
  UserPlus,
  Lightbulb,
  BarChart3,
  CheckCircle,
  X,
  ChevronRight,
  Sparkles,
  AlertTriangle,
  Signal,
  Layers,
  Trash2,
} from "lucide-react";

const categoryMeta: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  sim_config: { label: "SIM Config", icon: Cpu, color: "bg-blue-500/10 text-blue-700 border-blue-500/20" },
  contact: { label: "Contact", icon: UserPlus, color: "bg-green-500/10 text-green-700 border-green-500/20" },
  action: { label: "Action", icon: Lightbulb, color: "bg-yellow-500/10 text-yellow-700 border-yellow-500/20" },
  resource: { label: "Resource", icon: BarChart3, color: "bg-purple-500/10 text-purple-700 border-purple-500/20" },
  performance: { label: "Performance", icon: Zap, color: "bg-orange-500/10 text-orange-700 border-orange-500/20" },
};

export function AiAutomationPanel() {
  const {
    recommendations,
    pendingCount,
    runAiAction,
    applyRecommendation,
    dismissRecommendation,
    clearResolved,
  } = useAiAutomation();

  const [activeCategory, setActiveCategory] = useState("all");
  const isRunning = runAiAction.isPending;

  const allRecs = recommendations.data || [];
  const filtered = activeCategory === "all"
    ? allRecs
    : allRecs.filter(r => r.category === activeCategory);

  const pendingRecs = filtered.filter(r => r.status === "pending");
  const resolvedRecs = filtered.filter(r => r.status !== "pending");

  const categoryCounts = allRecs.reduce<Record<string, number>>((acc, r) => {
    if (r.status === "pending") {
      acc[r.category] = (acc[r.category] || 0) + 1;
    }
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* AI Action Buttons */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <ActionCard
          title="Auto-Config SIMs"
          description="Detect & configure SIM ports"
          icon={Cpu}
          isLoading={isRunning}
          onClick={() => runAiAction.mutate("auto_configure_sims")}
        />
        <ActionCard
          title="Discover Contacts"
          description="Extract names from SMS patterns"
          icon={UserPlus}
          isLoading={isRunning}
          onClick={() => runAiAction.mutate("auto_create_contacts")}
        />
        <ActionCard
          title="Suggest Actions"
          description="AI dashboard recommendations"
          icon={Lightbulb}
          isLoading={isRunning}
          onClick={() => runAiAction.mutate("suggest_actions")}
        />
        <ActionCard
          title="Optimize Resources"
          description="Load balance & tune polling"
          icon={BarChart3}
          isLoading={isRunning}
          onClick={() => runAiAction.mutate("resource_optimize")}
        />
        <ActionCard
          title="Full Optimization"
          description="Run all AI modules at once"
          icon={Sparkles}
          isLoading={isRunning}
          onClick={() => runAiAction.mutate("auto_optimize")}
          variant="primary"
        />
      </div>

      {/* Recommendations Feed */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-primary" />
                AI Recommendations
                {pendingCount > 0 && (
                  <Badge variant="secondary">{pendingCount} pending</Badge>
                )}
              </CardTitle>
              <CardDescription>
                Review and apply AI-generated suggestions
              </CardDescription>
            </div>
            {resolvedRecs.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => clearResolved.mutate()}
                disabled={clearResolved.isPending}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Clear resolved
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {/* Category filter tabs */}
          <div className="flex flex-wrap gap-2 mb-4">
            <FilterChip
              label="All"
              count={allRecs.filter(r => r.status === "pending").length}
              active={activeCategory === "all"}
              onClick={() => setActiveCategory("all")}
            />
            {Object.entries(categoryMeta).map(([key, meta]) => (
              <FilterChip
                key={key}
                label={meta.label}
                count={categoryCounts[key] || 0}
                active={activeCategory === key}
                onClick={() => setActiveCategory(key)}
              />
            ))}
          </div>

          {recommendations.isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />
              ))}
            </div>
          ) : pendingRecs.length === 0 && resolvedRecs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Brain className="h-12 w-12 mx-auto mb-3 opacity-40" />
              <p className="font-medium">No recommendations yet</p>
              <p className="text-sm mt-1">Run an AI action above to generate suggestions</p>
            </div>
          ) : (
            <ScrollArea className="h-[450px]">
              <div className="space-y-3">
                {pendingRecs.map((rec) => (
                  <RecommendationCard
                    key={rec.id}
                    rec={rec}
                    onApply={() => applyRecommendation.mutate(rec.id)}
                    onDismiss={() => dismissRecommendation.mutate(rec.id)}
                    isApplying={applyRecommendation.isPending}
                  />
                ))}
                {resolvedRecs.map((rec) => (
                  <RecommendationCard
                    key={rec.id}
                    rec={rec}
                    onApply={() => {}}
                    onDismiss={() => {}}
                    isApplying={false}
                    resolved
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ========== Sub-components ==========

function ActionCard({
  title,
  description,
  icon: Icon,
  isLoading,
  onClick,
  variant,
}: {
  title: string;
  description: string;
  icon: React.ElementType;
  isLoading: boolean;
  onClick: () => void;
  variant?: "primary";
}) {
  return (
    <Card
      className={`cursor-pointer transition-all hover:shadow-md hover:border-primary/30 ${
        variant === "primary" ? "border-primary/40 bg-primary/5" : ""
      }`}
      onClick={isLoading ? undefined : onClick}
    >
      <CardContent className="p-4 flex flex-col items-center text-center gap-2">
        {isLoading ? (
          <RefreshCw className="h-8 w-8 text-primary animate-spin" />
        ) : (
          <Icon className={`h-8 w-8 ${variant === "primary" ? "text-primary" : "text-muted-foreground"}`} />
        )}
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground hover:bg-muted/80"
      }`}
    >
      {label}
      {count > 0 && (
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
          active ? "bg-primary-foreground/20" : "bg-background"
        }`}>
          {count}
        </span>
      )}
    </button>
  );
}

function RecommendationCard({
  rec,
  onApply,
  onDismiss,
  isApplying,
  resolved,
}: {
  rec: AiRecommendation;
  onApply: () => void;
  onDismiss: () => void;
  isApplying: boolean;
  resolved?: boolean;
}) {
  const meta = categoryMeta[rec.category] || categoryMeta.action;
  const Icon = meta.icon;
  const priority = (rec.details as Record<string, string>)?.priority;

  return (
    <div
      className={`p-3 rounded-lg border transition-opacity ${
        resolved ? "opacity-50 bg-muted/30" : "bg-card"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-md border ${meta.color}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-medium truncate">{rec.title}</span>
            {priority && (
              <Badge
                variant={priority === "high" ? "destructive" : "secondary"}
                className="text-[10px] px-1.5 py-0"
              >
                {priority}
              </Badge>
            )}
            {rec.auto_applied && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-accent-foreground border-accent">
                Auto-applied
              </Badge>
            )}
            {rec.status === "applied" && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-accent-foreground">
                <CheckCircle className="h-3 w-3 mr-0.5" /> Applied
              </Badge>
            )}
            {rec.status === "dismissed" && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                Dismissed
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2">{rec.description}</p>
        </div>

        {!resolved && (
          <div className="flex items-center gap-1 shrink-0">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              onClick={onDismiss}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              className="h-7 gap-1 px-2"
              onClick={onApply}
              disabled={isApplying}
            >
              {isApplying ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
              ) : (
                <CheckCircle className="h-3 w-3" />
              )}
              Apply
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

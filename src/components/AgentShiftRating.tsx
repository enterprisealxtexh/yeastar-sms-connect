import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Star, StarOff, Award, Loader2, Send } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAgents, type Agent } from "@/hooks/useAgents";
import { format } from "date-fns";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:2003";

interface AgentRating {
  id: string;
  agent_id: string;
  rated_by: string;
  rating: number;
  comment: string | null;
  rating_date: string;
  created_at: string;
}

const useAgentRatings = () => {
  return useQuery({
    queryKey: ["agent-ratings"],
    queryFn: async () => {
      const res = await fetch(`${API_URL}/api/agent-ratings`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to load ratings");
      return (json.data || []) as AgentRating[];
    },
  });
};

const useSubmitRating = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { agent_id: string; rating: number; comment?: string }) => {
      const res = await fetch(`${API_URL}/api/agent-ratings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: input.agent_id,
          rating: input.rating,
          comment: input.comment?.trim() || null,
          rated_by: "supervisor",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to submit rating");

      // Fire-and-forget shift/rating notification
      fetch(`${API_URL}/api/notify/shift-change`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rating_notification",
          agent_id: input.agent_id,
          rating: input.rating,
          comment: input.comment?.trim() || null,
        }),
      }).catch(() => undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-ratings"] });
      toast.success("Rating submitted");
    },
    onError: (err: Error) => toast.error(err.message),
  });
};

const StarRating = ({ value, onChange, readonly = false }: { value: number; onChange?: (v: number) => void; readonly?: boolean }) => (
  <div className="flex gap-0.5">
    {[1, 2, 3, 4, 5].map((star) => (
      <button
        key={star}
        type="button"
        disabled={readonly}
        onClick={() => onChange?.(star)}
        className={`transition-colors ${readonly ? "cursor-default" : "cursor-pointer hover:scale-110"}`}
      >
        <Star
          className={`w-4 h-4 ${star <= value ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`}
        />
      </button>
    ))}
  </div>
);

export const AgentShiftRating = () => {
  const { data: agents = [] } = useAgents();
  const { data: ratings = [], isLoading } = useAgentRatings();
  const submitRating = useSubmitRating();
  const sendDigest = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_URL}/api/notify/shift-change`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "weekly_rating_digest" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to send digest");
      return json;
    },
    onSuccess: () => toast.success("Weekly digest sent to Telegram"),
    onError: (err: Error) => toast.error("Failed to send digest: " + err.message),
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState("");
  const [ratingValue, setRatingValue] = useState(0);
  const [comment, setComment] = useState("");

  const handleSubmit = () => {
    if (!selectedAgent || ratingValue === 0) return;
    submitRating.mutate(
      { agent_id: selectedAgent, rating: ratingValue, comment },
      {
        onSuccess: () => {
          setSelectedAgent("");
          setRatingValue(0);
          setComment("");
          setDialogOpen(false);
        },
      }
    );
  };

  // Compute average ratings per agent (all time)
  const agentAvgMap = new Map<string, { avg: number; count: number }>();
  ratings.forEach((r) => {
    const entry = agentAvgMap.get(r.agent_id) || { avg: 0, count: 0 };
    entry.avg = (entry.avg * entry.count + r.rating) / (entry.count + 1);
    entry.count += 1;
    agentAvgMap.set(r.agent_id, entry);
  });

  const agentMap = new Map(agents.map((a) => [a.id, a]));

  // Leaderboard: last 30 days
  const thirtyDaysAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split("T")[0];
  }, []);

  const leaderboard = useMemo(() => {
    const recent = ratings.filter((r) => r.rating_date >= thirtyDaysAgo);
    const map = new Map<string, { total: number; count: number; best: number; worst: number }>();
    recent.forEach((r) => {
      const entry = map.get(r.agent_id) || { total: 0, count: 0, best: 0, worst: 6 };
      entry.total += r.rating;
      entry.count += 1;
      entry.best = Math.max(entry.best, r.rating);
      entry.worst = Math.min(entry.worst, r.rating);
      map.set(r.agent_id, entry);
    });
    return Array.from(map.entries())
      .map(([id, s]) => ({
        agent: agentMap.get(id),
        avg: s.total / s.count,
        count: s.count,
        best: s.best,
        worst: s.worst === 6 ? 0 : s.worst,
      }))
      .filter((e) => e.agent)
      .sort((a, b) => b.avg - a.avg || b.count - a.count);
  }, [ratings, thirtyDaysAgo, agentMap]);

  const maxCount = Math.max(...leaderboard.map((l) => l.count), 1);
  const medals = ["🥇", "🥈", "🥉"];

  // Recent ratings with agent names
  const recentRatings = ratings.slice(0, 10);

  const [activeTab, setActiveTab] = useState("overview");

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Award className="w-4 h-4 text-amber-500" />
              Agent Shift Ratings
            </CardTitle>
            <CardDescription className="text-xs mt-1">Rate agent performance after their shift</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => sendDigest.mutate()}
              disabled={sendDigest.isPending}
            >
              {sendDigest.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Send Weekly Digest
            </Button>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5">
                  <Star className="w-3.5 h-3.5" /> Rate Agent
                </Button>
              </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Rate Agent Shift Performance</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label>Agent</Label>
                  <Select value={selectedAgent} onValueChange={setSelectedAgent}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select agent" />
                    </SelectTrigger>
                    <SelectContent>
                      {agents.map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Rating</Label>
                  <div className="flex items-center gap-3">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setRatingValue(star)}
                          className="cursor-pointer hover:scale-110 transition-transform"
                        >
                          <Star
                            className={`w-7 h-7 ${star <= ratingValue ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`}
                          />
                        </button>
                      ))}
                    </div>
                    {ratingValue > 0 && (
                      <span className="text-sm text-muted-foreground">
                        {["", "Poor", "Below Average", "Average", "Good", "Excellent"][ratingValue]}
                      </span>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Comment (optional)</Label>
                  <Textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Notes about shift performance..."
                    rows={3}
                    maxLength={500}
                    className="resize-none"
                  />
                </div>

                <Button
                  onClick={handleSubmit}
                  disabled={!selectedAgent || ratingValue === 0 || submitRating.isPending}
                  className="w-full gap-2"
                >
                  {submitRating.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Star className="w-4 h-4" />}
                  Submit Rating
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
            <TabsTrigger value="recent">Recent</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="mt-3">
            {agents.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {agents
                  .map((a) => ({ agent: a, stats: agentAvgMap.get(a.id) }))
                  .sort((a, b) => (b.stats?.avg || 0) - (a.stats?.avg || 0))
                  .map(({ agent, stats }) => (
                    <div key={agent.id} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30 border border-border/30">
                      <div>
                        <div className="text-sm font-medium">{agent.name}</div>
                        {agent.extension && <div className="text-[10px] text-muted-foreground">Ext {agent.extension}</div>}
                      </div>
                      <div className="flex items-center gap-2">
                        {stats ? (
                          <>
                            <StarRating value={Math.round(stats.avg)} readonly />
                            <span className="text-xs text-muted-foreground">({stats.count})</span>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">No ratings</span>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </TabsContent>

          {/* Leaderboard Tab - Last 30 days */}
          <TabsContent value="leaderboard" className="mt-3">
            {leaderboard.length > 0 ? (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">Rankings based on ratings from the last 30 days</p>
                {leaderboard.map((entry, idx) => (
                  <div
                    key={entry.agent!.id}
                    className={`p-3 rounded-lg border transition-all ${
                      idx === 0
                        ? "border-primary/40 bg-primary/5"
                        : idx < 3
                        ? "border-border/50 bg-muted/20"
                        : "border-border/30 bg-muted/10"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2.5">
                        <span className="text-lg w-7 text-center">{medals[idx] || `#${idx + 1}`}</span>
                        <div>
                          <div className="text-sm font-semibold">{entry.agent!.name}</div>
                          {entry.agent!.extension && (
                            <div className="text-[10px] text-muted-foreground">Ext {entry.agent!.extension}</div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <StarRating value={Math.round(entry.avg)} readonly />
                        <span className="text-sm font-bold tabular-nums">{entry.avg.toFixed(1)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Progress value={(entry.count / maxCount) * 100} className="h-1.5 flex-1" />
                      <div className="flex gap-3 text-[10px] text-muted-foreground shrink-0">
                        <span>{entry.count} review{entry.count !== 1 ? "s" : ""}</span>
                        <span>Best: {entry.best}★</span>
                        <span>Low: {entry.worst}★</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-sm text-muted-foreground">
                <Award className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
                No ratings in the last 30 days.
              </div>
            )}
          </TabsContent>

          {/* Recent Ratings Tab */}
          <TabsContent value="recent" className="mt-3">
            {isLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : recentRatings.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead>Rating</TableHead>
                    <TableHead>Comment</TableHead>
                    <TableHead className="text-right">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentRatings.map((r) => {
                    const agent = agentMap.get(r.agent_id);
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium text-sm">{agent?.name || "Unknown"}</TableCell>
                        <TableCell>
                          <StarRating value={r.rating} readonly />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                          {r.comment || "—"}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {format(new Date(r.rating_date), "dd MMM")}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-6 text-sm text-muted-foreground">
                <StarOff className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
                No ratings yet. Rate an agent after their shift.
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

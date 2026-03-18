import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ratingsApi } from "@/lib/api-client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";

type RatingQuestion = {
  id: string;
  text: string;
  type?: "stars";
  required?: boolean;
};

type ExtensionPolicy = {
  extension: string;
  require_clock_in: boolean;
};

type RatingSettings = {
  enabled: boolean;
  company_name: string;
  company_icon_url: string;
  public_base_url: string;
  link_valid_hours: number;
  trigger_source: "auto_reply" | "call_auto_sms" | "both";
  include_recommendation: boolean;
  questions: RatingQuestion[];
  extension_policies: ExtensionPolicy[];
};

const defaultSettings: RatingSettings = {
  enabled: false,
  company_name: "Customer Support",
  company_icon_url: "",
  public_base_url: "app_url/support/rating",
  link_valid_hours: 24,
  trigger_source: "both",
  include_recommendation: true,
  questions: [{ id: "q1", text: "How would you rate our service?", type: "stars", required: true }],
  extension_policies: [],
};

const chartColors = [
  "#0ea5e9",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#14b8a6",
  "#eab308",
  "#ec4899",
  "#6366f1",
  "#84cc16",
];

export const CustomerRatingsPanel = () => {
  const queryClient = useQueryClient();
  const { role } = useAuth();
  const canEdit = role === "super_admin";

  const [activeTab, setActiveTab] = useState<"analytics" | "configuration">("analytics");
  const [settings, setSettings] = useState<RatingSettings>(defaultSettings);

  const [days, setDays] = useState(30);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [agentId, setAgentId] = useState("");
  const [source, setSource] = useState("");
  const [extension, setExtension] = useState("");
  const [minRating, setMinRating] = useState("");
  const [maxRating, setMaxRating] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data: settingsData, isLoading: settingsLoading } = useQuery({
    queryKey: ["ratings-settings"],
    queryFn: () => ratingsApi.settings(),
  });

  const analyticsParams = useMemo(
    () => ({
      days,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      agentId: agentId || undefined,
      source: source || undefined,
      extension: extension || undefined,
      minRating: minRating || undefined,
      maxRating: maxRating || undefined,
      search: search || undefined,
      page,
      pageSize,
    }),
    [days, startDate, endDate, agentId, source, extension, minRating, maxRating, search, page, pageSize]
  );

  const { data: analyticsData, isLoading: analyticsLoading } = useQuery({
    queryKey: ["ratings-analytics", analyticsParams],
    queryFn: () => ratingsApi.analytics(analyticsParams),
  });

  useEffect(() => {
    if (!settingsData) return;
    setSettings({
      ...defaultSettings,
      ...settingsData,
      questions: Array.isArray(settingsData.questions) && settingsData.questions.length > 0
        ? settingsData.questions
        : defaultSettings.questions,
      extension_policies: Array.isArray(settingsData.extension_policies) ? settingsData.extension_policies : [],
    });
  }, [settingsData]);

  useEffect(() => {
    setPage(1);
  }, [days, startDate, endDate, agentId, source, extension, minRating, maxRating, search, pageSize]);

  const saveMutation = useMutation({
    mutationFn: () => ratingsApi.saveSettings(settings),
    onSuccess: (res) => {
      if (!res.success) {
        toast.error(res.error || "Failed to save settings");
        return;
      }
      toast.success("Rating settings saved");
      queryClient.invalidateQueries({ queryKey: ["ratings-settings"] });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to save settings");
    },
  });

  const openPreview = () => {
    try {
      // Create preview data with sample agents that might be available
      const previewData = {
        settings,
        possible_agents: [
          { id: "1", name: "Sample Agent 1", extension: "1001" },
          { id: "2", name: "Sample Agent 2", extension: "1002" },
        ],
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };

      // Store in sessionStorage so the preview page can access it
      sessionStorage.setItem("ratingPreviewSettings", JSON.stringify(previewData));

      // Open preview in a new window
      const previewUrl = `${window.location.origin}/preview/rating/preview`;
      window.open(previewUrl, "preview", "width=900,height=900,resizable=yes,scrollbars=yes");
    } catch (err) {
      toast.error("Failed to open preview");
    }
  };

  const summary = analyticsData?.summary || { total_submissions: 0, avg_overall_rating: 0, avg_recommend_rating: 0 };
  const byAgent = Array.isArray(analyticsData?.byAgent) ? analyticsData.byAgent : [];
  const rows = Array.isArray(analyticsData?.rows) ? analyticsData.rows : [];
  const trend = Array.isArray(analyticsData?.trend) ? analyticsData.trend : [];
  const agentOptions = Array.isArray(analyticsData?.agents) ? analyticsData.agents : [];
  const pagination = analyticsData?.pagination || { page: 1, pageSize: 20, total: 0, totalPages: 1 };

  const lineAgents = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const point of trend) {
      const name = String(point.agent_name || "-");
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
    return names;
  }, [trend]);

  const trendData = useMemo(() => {
    const byDay: Record<string, any> = {};
    for (const point of trend) {
      const day = String(point.day || "");
      const agent = String(point.agent_name || "-");
      if (!byDay[day]) byDay[day] = { day };
      byDay[day][agent] = Number(point.avg_rating || 0);
    }
    return Object.values(byDay).sort((a: any, b: any) => String(a.day).localeCompare(String(b.day)));
  }, [trend]);

  const publicPreviewLink = useMemo(() => {
    const base = String(settings.public_base_url || "").replace(/\/+$/, "");
    return base ? `${base}/<token>` : "";
  }, [settings.public_base_url]);

  const resetFilters = () => {
    setDays(30);
    setStartDate("");
    setEndDate("");
    setAgentId("");
    setSource("");
    setExtension("");
    setMinRating("");
    setMaxRating("");
    setSearch("");
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button
          variant={activeTab === "analytics" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveTab("analytics")}
        >
          Analytics
        </Button>
        <Button
          variant={activeTab === "configuration" ? "default" : "outline"}
          size="sm"
          onClick={() => setActiveTab("configuration")}
        >
          Configuration
        </Button>
      </div>

      {activeTab === "analytics" && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Ratings Analytics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>Period</Label>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value || 30))}
                  >
                    <option value={7}>Last 7 days</option>
                    <option value={30}>Last 30 days</option>
                    <option value={90}>Last 90 days</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>End Date</Label>
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>Served By</Label>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={agentId}
                    onChange={(e) => setAgentId(e.target.value)}
                  >
                    <option value="">All users</option>
                    {agentOptions.map((a: any) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Source</Label>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  >
                    <option value="">All sources</option>
                    <option value="auto_reply">Auto Reply</option>
                    <option value="call_auto_sms">Call Auto-SMS</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Extension</Label>
                  <Input value={extension} onChange={(e) => setExtension(e.target.value)} placeholder="e.g. 1001" />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-4">
                <div className="space-y-2 md:col-span-2">
                  <Label>Search</Label>
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Phone, served-by, extension, comment"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Min Rating</Label>
                  <Input type="number" min={1} max={5} value={minRating} onChange={(e) => setMinRating(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Max Rating</Label>
                  <Input type="number" min={1} max={5} value={maxRating} onChange={(e) => setMaxRating(e.target.value)} />
                </div>
              </div>

              <div>
                <Button variant="outline" size="sm" onClick={resetFilters}>Reset Filters</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              {analyticsLoading ? (
                <p className="text-sm text-muted-foreground">Loading analytics...</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-3">
                  <Card className="border-border/50">
                    <CardContent className="pt-6">
                      <p className="text-xs text-muted-foreground">Total Submissions</p>
                      <p className="text-2xl font-semibold">{summary.total_submissions || 0}</p>
                    </CardContent>
                  </Card>
                  <Card className="border-border/50">
                    <CardContent className="pt-6">
                      <p className="text-xs text-muted-foreground">Average Overall Rating</p>
                      <p className="text-2xl font-semibold">{summary.avg_overall_rating || 0} / 5</p>
                    </CardContent>
                  </Card>
                  <Card className="border-border/50">
                    <CardContent className="pt-6">
                      <p className="text-xs text-muted-foreground">Average Recommendation</p>
                      <p className="text-2xl font-semibold">{summary.avg_recommend_rating || 0} / 5</p>
                    </CardContent>
                  </Card>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Rating Trend by User</CardTitle>
            </CardHeader>
            <CardContent>
              {trendData.length === 0 ? (
                <p className="text-sm text-muted-foreground">No trend data for the current filter.</p>
              ) : (
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" />
                      <YAxis domain={[1, 5]} />
                      <Tooltip />
                      <Legend />
                      {lineAgents.map((agent, idx) => (
                        <Line
                          key={agent}
                          type="monotone"
                          dataKey={agent}
                          stroke={chartColors[idx % chartColors.length]}
                          strokeWidth={2}
                          dot={false}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Agent Comparison</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {byAgent.length === 0 && <p className="text-sm text-muted-foreground">No ratings yet.</p>}
                {byAgent.map((a: any) => (
                  <Badge key={`${a.agent_id}-${a.agent_name}`} variant="secondary" className="px-3 py-1">
                    {a.agent_name}: {a.avg_rating || 0}/5 ({a.total || 0})
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ratings Table</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  Showing page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Rows</Label>
                  <select
                    className="rounded-md border bg-background px-2 py-1 text-sm"
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value || 20))}
                  >
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="p-2 text-left">Time</th>
                      <th className="p-2 text-left">Phone</th>
                      <th className="p-2 text-left">Served By</th>
                      <th className="p-2 text-left">Overall</th>
                      <th className="p-2 text-left">Recommend</th>
                      <th className="p-2 text-left">Source</th>
                      <th className="p-2 text-left">Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td className="p-3 text-muted-foreground" colSpan={7}>No rating submissions for this filter.</td>
                      </tr>
                    )}
                    {rows.map((r: any) => (
                      <tr key={r.id} className="border-t">
                        <td className="p-2 whitespace-nowrap">{new Date(r.submitted_at).toLocaleString()}</td>
                        <td className="p-2">{r.phone_number}</td>
                        <td className="p-2">{r.agent_name || "-"}</td>
                        <td className="p-2">{r.overall_rating}/5</td>
                        <td className="p-2">{r.recommend_rating ? `${r.recommend_rating}/5` : "-"}</td>
                        <td className="p-2">{r.source || "-"}</td>
                        <td className="p-2 max-w-[360px] truncate">{r.comments || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={pagination.page <= 1}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(pagination.totalPages || 1, p + 1))}
                  disabled={pagination.page >= pagination.totalPages}
                >
                  Next
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {activeTab === "configuration" && (
        <Card>
          <CardHeader>
            <CardTitle>Customer Ratings Setup</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {settingsLoading ? (
              <p className="text-sm text-muted-foreground">Loading rating settings...</p>
            ) : (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Enable Rating Links</Label>
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={!!settings.enabled}
                        onCheckedChange={(v) => setSettings((s) => ({ ...s, enabled: v }))}
                        disabled={!canEdit}
                      />
                      <span className="text-sm text-muted-foreground">Generate links from system auto-replies</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Link Validity (Hours)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={168}
                      value={settings.link_valid_hours}
                      onChange={(e) => setSettings((s) => ({ ...s, link_valid_hours: Number(e.target.value || 24) }))}
                      disabled={!canEdit}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Company Name</Label>
                    <Input
                      value={settings.company_name}
                      onChange={(e) => setSettings((s) => ({ ...s, company_name: e.target.value }))}
                      disabled={!canEdit}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Company Icon URL</Label>
                    <Input
                      value={settings.company_icon_url}
                      onChange={(e) => setSettings((s) => ({ ...s, company_icon_url: e.target.value }))}
                      placeholder="https://.../logo.png"
                      disabled={!canEdit}
                    />
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <Label>Public Rating Base URL</Label>
                    <Input
                      value={settings.public_base_url}
                      onChange={(e) => setSettings((s) => ({ ...s, public_base_url: e.target.value }))}
                      placeholder="app_url/support/rating"
                      disabled={!canEdit}
                    />
                    <p className="text-xs text-muted-foreground">Preview: {publicPreviewLink || "-"}</p>
                  </div>

                  <div className="space-y-2">
                    <Label>Link Trigger Source</Label>
                    <select
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      value={settings.trigger_source}
                      onChange={(e) => setSettings((s) => ({ ...s, trigger_source: e.target.value as RatingSettings["trigger_source"] }))}
                      disabled={!canEdit}
                    >
                      <option value="both">Both Auto-Reply and Call Auto-SMS</option>
                      <option value="auto_reply">Auto-Reply only</option>
                      <option value="call_auto_sms">Call Auto-SMS only</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label>Ask Recommendation Score</Label>
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={!!settings.include_recommendation}
                        onCheckedChange={(v) => setSettings((s) => ({ ...s, include_recommendation: v }))}
                        disabled={!canEdit}
                      />
                      <span className="text-sm text-muted-foreground">Show 1-5 recommendation question</span>
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">Rating Questions (5-star)</h3>
                    {canEdit && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const id = `q${Date.now()}`;
                          setSettings((s) => ({
                            ...s,
                            questions: [...s.questions, { id, text: "New question", type: "stars", required: false }],
                          }));
                        }}
                      >
                        Add Question
                      </Button>
                    )}
                  </div>

                  {settings.questions.map((q, idx) => (
                    <div key={q.id} className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
                      <Input
                        value={q.text}
                        onChange={(e) => {
                          const next = [...settings.questions];
                          next[idx] = { ...next[idx], text: e.target.value };
                          setSettings((s) => ({ ...s, questions: next }));
                        }}
                        disabled={!canEdit}
                      />
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={!!q.required}
                          onChange={(e) => {
                            const next = [...settings.questions];
                            next[idx] = { ...next[idx], required: e.target.checked };
                            setSettings((s) => ({ ...s, questions: next }));
                          }}
                          disabled={!canEdit}
                        />
                        Required
                      </label>
                      {canEdit && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            setSettings((s) => ({ ...s, questions: s.questions.filter((x) => x.id !== q.id) }));
                          }}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  ))}
                </div>

                <Separator />

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">Extension Clock-In Rules</h3>
                    {canEdit && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSettings((s) => ({
                            ...s,
                            extension_policies: [...s.extension_policies, { extension: "", require_clock_in: true }],
                          }));
                        }}
                      >
                        Add Extension Rule
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    If enabled for an extension, a rating link is only generated when at least one agent on that extension is actively clocked in.
                  </p>

                  {settings.extension_policies.map((p, idx) => (
                    <div key={`${p.extension}-${idx}`} className="grid gap-2 md:grid-cols-[180px_1fr_auto]">
                      <Input
                        value={p.extension}
                        placeholder="e.g. 1001"
                        onChange={(e) => {
                          const next = [...settings.extension_policies];
                          next[idx] = { ...next[idx], extension: e.target.value };
                          setSettings((s) => ({ ...s, extension_policies: next }));
                        }}
                        disabled={!canEdit}
                      />
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={!!p.require_clock_in}
                          onChange={(e) => {
                            const next = [...settings.extension_policies];
                            next[idx] = { ...next[idx], require_clock_in: e.target.checked };
                            setSettings((s) => ({ ...s, extension_policies: next }));
                          }}
                          disabled={!canEdit}
                        />
                        Require active clock-in
                      </label>
                      {canEdit && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            setSettings((s) => ({ ...s, extension_policies: s.extension_policies.filter((_, i) => i !== idx) }));
                          }}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  ))}
                </div>

                {canEdit && (
                  <div className="pt-2 flex gap-2">
                    <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                      {saveMutation.isPending ? "Saving..." : "Save Rating Settings"}
                    </Button>
                    <Button variant="outline" onClick={openPreview}>
                      Preview
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default CustomerRatingsPanel;

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
  public_base_url: "https://calls.nosteq.co.ke/admin/rate",
  link_valid_hours: 24,
  trigger_source: "both",
  include_recommendation: true,
  questions: [{ id: "q1", text: "How would you rate our service?", type: "stars", required: true }],
  extension_policies: [],
};

export const CustomerRatingsPanel = () => {
  const queryClient = useQueryClient();
  const { role } = useAuth();
  const canEdit = role === "super_admin";
  const [activeTab, setActiveTab] = useState<"analytics" | "configuration">("analytics");

  const [settings, setSettings] = useState<RatingSettings>(defaultSettings);

  const { data: settingsData, isLoading: settingsLoading } = useQuery({
    queryKey: ["ratings-settings"],
    queryFn: () => ratingsApi.settings(),
  });

  const { data: analyticsData, isLoading: analyticsLoading } = useQuery({
    queryKey: ["ratings-analytics"],
    queryFn: () => ratingsApi.analytics(30),
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

  const summary = analyticsData?.summary || { total_submissions: 0, avg_overall_rating: 0, avg_recommend_rating: 0 };
  const byAgent = Array.isArray(analyticsData?.byAgent) ? analyticsData.byAgent : [];
  const rows = Array.isArray(analyticsData?.rows) ? analyticsData.rows : [];

  const publicPreviewLink = useMemo(() => {
    const base = String(settings.public_base_url || "").replace(/\/+$/, "");
    return base ? `${base}/<token>` : "";
  }, [settings.public_base_url]);

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
                    placeholder="https://calls.nosteq.co.ke/admin/rate"
                    disabled={!canEdit}
                  />
                  <p className="text-xs text-muted-foreground">Preview: {publicPreviewLink || "—"}</p>
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
                    <span className="text-sm text-muted-foreground">Show 1–5 recommendation question</span>
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
                  <div className="pt-2">
                    <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                      {saveMutation.isPending ? "Saving..." : "Save Rating Settings"}
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === "analytics" && (
        <Card>
          <CardHeader>
            <CardTitle>Ratings Analytics (Last 30 Days)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {analyticsLoading ? (
              <p className="text-sm text-muted-foreground">Loading analytics...</p>
            ) : (
              <>
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

              <div className="space-y-2">
                <h3 className="font-medium">Agent Leaderboard</h3>
                <div className="flex flex-wrap gap-2">
                  {byAgent.length === 0 && <p className="text-sm text-muted-foreground">No ratings yet.</p>}
                  {byAgent.map((a: any) => (
                    <Badge key={`${a.agent_id || "none"}-${a.agent_name}`} variant="secondary" className="px-3 py-1">
                      {a.agent_name}: {a.avg_rating || 0}/5 ({a.total || 0})
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="font-medium">Latest Ratings</h3>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="p-2 text-left">Time</th>
                        <th className="p-2 text-left">Phone</th>
                        <th className="p-2 text-left">Agent</th>
                        <th className="p-2 text-left">Overall</th>
                        <th className="p-2 text-left">Recommend</th>
                        <th className="p-2 text-left">Comment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 && (
                        <tr>
                          <td className="p-3 text-muted-foreground" colSpan={6}>No rating submissions yet.</td>
                        </tr>
                      )}
                      {rows.map((r: any) => (
                        <tr key={r.id} className="border-t">
                          <td className="p-2 whitespace-nowrap">{new Date(r.submitted_at).toLocaleString()}</td>
                          <td className="p-2">{r.phone_number}</td>
                          <td className="p-2">{r.agent_name}</td>
                          <td className="p-2">{r.overall_rating}/5</td>
                          <td className="p-2">{r.recommend_rating ? `${r.recommend_rating}/5` : "—"}</td>
                          <td className="p-2 max-w-[360px] truncate">{r.comments || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default CustomerRatingsPanel;

import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ratingsApi } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Star } from "lucide-react";

type Answers = Record<string, number>;

const StarPicker = ({ value, onChange }: { value: number; onChange: (v: number) => void }) => {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className="p-1"
          onClick={() => onChange(n)}
          aria-label={`Rate ${n} stars`}
        >
          <Star className={`h-5 w-5 ${n <= value ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
        </button>
      ))}
    </div>
  );
};

const RatingPublicPage = () => {
  const { token = "" } = useParams();

  const [overallRating, setOverallRating] = useState(0);
  const [recommendRating, setRecommendRating] = useState(0);
  const [comments, setComments] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [answers, setAnswers] = useState<Answers>({});
  const [submitted, setSubmitted] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["public-rating-form", token],
    queryFn: () => ratingsApi.publicForm(token),
    enabled: !!token,
    retry: false,
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      ratingsApi.submitPublic(token, {
        overall_rating: overallRating,
        recommend_rating: data?.settings?.include_recommendation ? recommendRating || null : null,
        comments,
        answers,
        agent_id: selectedAgentId || null,
      }),
    onSuccess: (res) => {
      if (res.success) {
        setSubmitted(true);
      }
    },
  });

  const questions = useMemo(() => (Array.isArray(data?.settings?.questions) ? data.settings.questions : []), [data]);
  const agents = useMemo(() => (Array.isArray(data?.possible_agents) ? data.possible_agents : []), [data]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-xl">
          <CardContent className="pt-6">Loading rating form...</CardContent>
        </Card>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle>Rating Link Unavailable</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              This rating link is invalid, expired, or already used.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle>Thank You</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Your feedback has been submitted successfully.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <div className="flex items-center gap-3">
            {data.settings?.company_icon_url ? (
              <img
                src={data.settings.company_icon_url}
                alt="Company icon"
                className="h-10 w-10 rounded object-cover"
              />
            ) : null}
            <div>
              <CardTitle>{data.settings?.company_name || "Customer Support"}</CardTitle>
              <p className="text-xs text-muted-foreground">Please rate your service experience</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {agents.length > 1 && (
            <div className="space-y-2">
              <Label>Which support agent assisted you?</Label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
              >
                <option value="">Select agent</option>
                {agents.map((a: any) => (
                  <option key={a.id} value={a.id}>
                    {a.name} {a.extension ? `(Ext ${a.extension})` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {agents.length === 1 && (
            <div className="rounded-md border p-3 text-sm">
              Served by: <strong>{agents[0].name}</strong>
            </div>
          )}

          <div className="space-y-2">
            <Label>Overall Service Rating</Label>
            <StarPicker value={overallRating} onChange={setOverallRating} />
          </div>

          {questions.map((q: any) => (
            <div key={q.id} className="space-y-2">
              <Label>{q.text}</Label>
              <StarPicker
                value={answers[q.id] || 0}
                onChange={(v) => setAnswers((prev) => ({ ...prev, [q.id]: v }))}
              />
            </div>
          ))}

          {data.settings?.include_recommendation && (
            <div className="space-y-2">
              <Label>How likely are you to recommend our service?</Label>
              <StarPicker value={recommendRating} onChange={setRecommendRating} />
            </div>
          )}

          <div className="space-y-2">
            <Label>Comments (Optional)</Label>
            <Textarea
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              rows={4}
              placeholder="Share any feedback about your experience..."
            />
          </div>

          <div className="text-xs text-muted-foreground">
            Link expires: {new Date(data.expires_at).toLocaleString()}
          </div>

          <Button
            className="w-full"
            onClick={() => submitMutation.mutate()}
            disabled={submitMutation.isPending || overallRating < 1}
          >
            {submitMutation.isPending ? "Submitting..." : "Submit Feedback"}
          </Button>

          {!submitMutation.isPending && submitMutation.isError && (
            <p className="text-sm text-destructive">Failed to submit feedback. Please refresh and try again.</p>
          )}

          {!submitMutation.isPending && submitMutation.data && !submitMutation.data.success && (
            <p className="text-sm text-destructive">{submitMutation.data.error || "Failed to submit feedback"}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default RatingPublicPage;

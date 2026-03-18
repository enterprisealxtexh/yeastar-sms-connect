import { useMemo, useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ratingsApi } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Star, X } from "lucide-react";

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
  const [isPreview, setIsPreview] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);

  useEffect(() => {
    // Check if this is a preview mode (check sessionStorage for preview data)
    try {
      const stored = sessionStorage.getItem("ratingPreviewSettings");
      if (stored) {
        setIsPreview(true);
        setPreviewData(JSON.parse(stored));
      }
    } catch (e) {
      // Ignore error
    }
  }, []);

  const [overallRating, setOverallRating] = useState(0);
  const [recommendRating, setRecommendRating] = useState(0);
  const [comments, setComments] = useState("");
  const [answers, setAnswers] = useState<Answers>({});
  const [submitted, setSubmitted] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["public-rating-form", token],
    queryFn: () => ratingsApi.publicForm(token),
    enabled: !!token && !isPreview,
    retry: false,
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      ratingsApi.submitPublic(token, {
        overall_rating: overallRating,
        recommend_rating: (data?.settings || previewData?.settings)?.include_recommendation ? recommendRating || null : null,
        comments,
        answers,
        agent_id: effectiveData?.served_by_agent?.id || null,
      }),
    onSuccess: (res) => {
      if (res.success) {
        setSubmitted(true);
      }
    },
  });

  const effectiveData = isPreview ? previewData : data;
  const questions = useMemo(() => (Array.isArray(effectiveData?.settings?.questions) ? effectiveData.settings.questions : []), [effectiveData]);

  if (!isPreview && isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-xl">
          <CardContent className="pt-6">Loading rating form...</CardContent>
        </Card>
      </div>
    );
  }

  if (!isPreview && (error || !data)) {
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

  if (submitted && !isPreview) {
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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {effectiveData?.settings?.company_icon_url ? (
                <img
                  src={effectiveData.settings.company_icon_url}
                  alt="Company icon"
                  className="h-10 w-10 rounded object-cover"
                />
              ) : null}
              <div>
                <CardTitle>{effectiveData?.settings?.company_name || "Customer Support"}</CardTitle>
                <p className="text-xs text-muted-foreground">Please rate your service experience</p>
              </div>
            </div>
            {isPreview && (
              <div className="flex items-center gap-2">
                <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">Preview Mode</span>
                <button
                  onClick={() => window.close()}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Close preview"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {effectiveData?.served_by_agent && (
            <div className="rounded-md border p-3 text-sm bg-muted/30">
              Served by: <strong>{effectiveData.served_by_agent.name}</strong>
              {effectiveData.served_by_agent.extension && (
                <span className="text-xs text-muted-foreground ml-2">(Ext {effectiveData.served_by_agent.extension})</span>
              )}
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

          {effectiveData?.settings?.include_recommendation && (
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
              disabled={isPreview}
            />
          </div>

          {!isPreview && (
            <>
              <div className="text-xs text-muted-foreground">
                Link expires: {new Date(effectiveData?.expires_at).toLocaleString()}
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
            </>
          )}

          {isPreview && (
            <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-sm text-blue-700">
              Preview mode: Submit button is disabled. Close this window to return to configuration.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default RatingPublicPage;

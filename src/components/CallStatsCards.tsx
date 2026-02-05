import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Phone, PhoneMissed, Clock, Timer } from "lucide-react";

interface CallStatsCardsProps {
  stats: {
    totalCalls: number;
    answered: number;
    missed: number;
    avgTalkDuration: number;
    avgRingDuration: number;
  } | undefined;
  isLoading: boolean;
}

const formatDuration = (seconds: number): string => {
  if (!seconds || seconds === 0) return "0s";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
};

export const CallStatsCards = ({ stats, isLoading }: CallStatsCardsProps) => {
  const cards = [
    {
      title: "Total Calls Today",
      value: stats?.totalCalls ?? 0,
      icon: Phone,
      color: "text-primary",
      bg: "bg-primary/10",
    },
    {
      title: "Answered",
      value: stats?.answered ?? 0,
      icon: Phone,
      color: "text-success",
      bg: "bg-success/10",
    },
    {
      title: "Missed",
      value: stats?.missed ?? 0,
      icon: PhoneMissed,
      color: "text-destructive",
      bg: "bg-destructive/10",
    },
    {
      title: "Avg Ring Time",
      value: formatDuration(stats?.avgRingDuration ?? 0),
      icon: Timer,
      color: "text-warning",
      bg: "bg-warning/10",
      isTime: true,
    },
    {
      title: "Avg Talk Time",
      value: formatDuration(stats?.avgTalkDuration ?? 0),
      icon: Clock,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
      isTime: true,
    },
  ];

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((card) => (
        <Card key={card.title} className="card-glow border-border/50 bg-card">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className={`flex items-center justify-center w-10 h-10 rounded-lg ${card.bg}`}>
                <card.icon className={`w-5 h-5 ${card.color}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{card.title}</p>
                <p className="text-2xl font-bold">{card.value}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Phone, PhoneMissed, Clock, Timer } from "lucide-react";

interface CallStats {
  totalCalls: number;
  answered: number;
  missed: number;
  totalTalkDuration: number;
  totalRingDuration: number;
}

interface CallStatsCardsProps {
  allTimeStats: CallStats | undefined;
  todayStats: CallStats | undefined;
  isLoading: boolean;
}

const formatDuration = (seconds: number): string => {
  if (!seconds || seconds === 0) return "0s";
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}h ${mins}m ${secs}s`;
  } else if (mins > 0) {
    return `${mins}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
};

export const CallStatsCards = ({ allTimeStats, todayStats, isLoading }: CallStatsCardsProps) => {
  const cards = [
    {
      title: "Total Calls",
      allTimeValue: allTimeStats?.totalCalls ?? 0,
      todayValue: todayStats?.totalCalls ?? 0,
      icon: Phone,
      color: "text-primary",
      bg: "bg-primary/10",
    },
    {
      title: "Answered",
      allTimeValue: allTimeStats?.answered ?? 0,
      todayValue: todayStats?.answered ?? 0,
      icon: Phone,
      color: "text-success",
      bg: "bg-success/10",
    },
    {
      title: "Missed",
      allTimeValue: allTimeStats?.missed ?? 0,
      todayValue: todayStats?.missed ?? 0,
      icon: PhoneMissed,
      color: "text-destructive",
      bg: "bg-destructive/10",
    },
    {
      title: "Ring Time",
      allTimeValue: formatDuration(allTimeStats?.totalRingDuration ?? 0),
      todayValue: formatDuration(todayStats?.totalRingDuration ?? 0),
      icon: Timer,
      color: "text-warning",
      bg: "bg-warning/10",
      isTime: true,
    },
    {
      title: "Talk Time",
      allTimeValue: formatDuration(allTimeStats?.totalTalkDuration ?? 0),
      todayValue: formatDuration(todayStats?.totalTalkDuration ?? 0),
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
          <Skeleton key={i} className="h-28 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((card) => (
        <Card key={card.title} className="card-glow border-border/50 bg-card">
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              <div className={`flex items-center justify-center w-10 h-10 rounded-lg flex-shrink-0 ${card.bg}`}>
                <card.icon className={`w-5 h-5 ${card.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">{card.title}</p>
                <div>
                  <p className="text-lg font-bold leading-tight">{card.allTimeValue}</p>
                  <p className="text-xs text-muted-foreground mt-1">Today: {card.todayValue}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

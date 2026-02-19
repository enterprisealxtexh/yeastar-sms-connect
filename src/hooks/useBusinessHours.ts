import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface BusinessHours {
  id: string;
  rule_id: string;
  start_time: string;
  end_time: string;
  days_enabled: string[];
  created_at: string;
  updated_at: string;
}

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:2003";

export const useBusinessHours = (ruleId: string | null) => {
  const queryClient = useQueryClient();

  const { data: hours = [], isLoading, error } = useQuery({
    queryKey: ["business-hours", ruleId],
    queryFn: async () => {
      if (!ruleId) return [];
      const response = await fetch(`${API_URL}/api/business-hours/${ruleId}`);
      if (!response.ok) throw new Error("Failed to fetch business hours");
      const result = await response.json();
      return result.data || [];
    },
    enabled: !!ruleId,
  });

  const createBusinessHours = useMutation({
    mutationFn: async (data: {
      rule_id: string;
      start_time: string;
      end_time: string;
      days_enabled: string[];
    }) => {
      const response = await fetch(`${API_URL}/api/business-hours`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to create business hours");
      return response.json();
    },
    onSuccess: () => {
      if (ruleId) {
        queryClient.invalidateQueries({
          queryKey: ["business-hours", ruleId],
        });
      }
    },
  });

  const deleteBusinessHours = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`${API_URL}/api/business-hours/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete business hours");
      return response.json();
    },
    onSuccess: () => {
      if (ruleId) {
        queryClient.invalidateQueries({
          queryKey: ["business-hours", ruleId],
        });
      }
    },
  });

  return {
    hours,
    isLoading,
    error,
    createBusinessHours: createBusinessHours.mutate,
    deleteBusinessHours: deleteBusinessHours.mutate,
    isCreating: createBusinessHours.isPending,
    isDeleting: deleteBusinessHours.isPending,
  };
};

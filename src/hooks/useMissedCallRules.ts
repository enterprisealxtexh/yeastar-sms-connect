import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface MissedCallRule {
  id: string;
  extensions: string[];
  threshold: number;
  template_id: string;
  gateway_id: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

const API_URL = import.meta.env.VITE_API_URL;

export const useMissedCallRules = () => {
  const queryClient = useQueryClient();

  const { data: rules = [], isLoading, error } = useQuery({
    queryKey: ["missed-call-rules"],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/api/missed-call-rules`);
      if (!response.ok) throw new Error("Failed to fetch rules");
      const result = await response.json();
      return result.data || [];
    },
  });

  const createRule = useMutation({
    mutationFn: async (data: {
      extensions: string[];
      threshold: number;
      template_id: string;
      gateway_id: string;
    }) => {
      const response = await fetch(`${API_URL}/api/missed-call-rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to create rule");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["missed-call-rules"] });
    },
  });

  const updateRule = useMutation({
    mutationFn: async ({
      id,
      extensions,
      threshold,
      template_id,
      gateway_id,
      active,
    }: {
      id: string;
      extensions: string[];
      threshold: number;
      template_id: string;
      gateway_id: string;
      active: boolean;
    }) => {
      const response = await fetch(`${API_URL}/api/missed-call-rules/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          extensions,
          threshold,
          template_id,
          gateway_id,
          active,
        }),
      });
      if (!response.ok) throw new Error("Failed to update rule");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["missed-call-rules"] });
    },
  });

  const deleteRule = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`${API_URL}/api/missed-call-rules/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete rule");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["missed-call-rules"] });
    },
  });

  return {
    rules,
    isLoading,
    error,
    createRule: createRule.mutate,
    updateRule: updateRule.mutate,
    deleteRule: deleteRule.mutate,
    isCreating: createRule.isPending,
    isUpdating: updateRule.isPending,
    isDeleting: deleteRule.isPending,
  };
};

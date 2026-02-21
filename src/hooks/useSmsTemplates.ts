import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface SmsTemplate {
  id: string;
  name: string;
  message: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

const API_URL = import.meta.env.VITE_API_URL;

export const useSmsTemplates = () => {
  const queryClient = useQueryClient();

  const { data: templates = [], isLoading, error } = useQuery({
    queryKey: ["sms-templates"],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/api/sms-templates`);
      if (!response.ok) throw new Error("Failed to fetch templates");
      const result = await response.json();
      return result.data || [];
    },
  });

  const createTemplate = useMutation({
    mutationFn: async (data: { name: string; message: string }) => {
      const response = await fetch(`${API_URL}/api/sms-templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to create template");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sms-templates"] });
    },
  });

  const updateTemplate = useMutation({
    mutationFn: async ({
      id,
      name,
      message,
      active,
    }: {
      id: string;
      name: string;
      message: string;
      active: boolean;
    }) => {
      const response = await fetch(`${API_URL}/api/sms-templates/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, message, active }),
      });
      if (!response.ok) throw new Error("Failed to update template");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sms-templates"] });
    },
  });

  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`${API_URL}/api/sms-templates/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete template");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sms-templates"] });
    },
  });

  return {
    templates,
    isLoading,
    error,
    createTemplate: createTemplate.mutate,
    updateTemplate: updateTemplate.mutate,
    deleteTemplate: deleteTemplate.mutate,
    isCreating: createTemplate.isPending,
    isUpdating: updateTemplate.isPending,
    isDeleting: deleteTemplate.isPending,
  };
};

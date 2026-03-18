import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { smsApi } from "@/lib/api-client";

export interface SmsTemplate {
  id: string;
  name: string;
  message: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export const useSmsTemplates = () => {
  const queryClient = useQueryClient();

  const { data: templates = [], isLoading, error } = useQuery({
    queryKey: ['sms-templates'],
    queryFn: async () => (await smsApi.templates()) as SmsTemplate[],
  });

  const createTemplate = useMutation({
    mutationFn: async (data: { name: string; message: string }) => {
      const result = await smsApi.createTemplate(data);
      if (!result.success) throw new Error(result.error || 'Failed to create template');
      return result.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sms-templates'] }),
  });

  const updateTemplate = useMutation({
    mutationFn: async ({ id, name, message, active }: { id: string; name: string; message: string; active: boolean }) => {
      const result = await smsApi.updateTemplate(id, { name, message, active });
      if (!result.success) throw new Error(result.error || 'Failed to update template');
      return result.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sms-templates'] }),
  });

  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => {
      const result = await smsApi.deleteTemplate(id);
      if (!result.success) throw new Error(result.error || 'Failed to delete template');
      return result.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sms-templates'] }),
  });

  return { templates, isLoading, error, createTemplate, updateTemplate, deleteTemplate };
};
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

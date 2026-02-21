import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface SmsGateway {
  id: string;
  url: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

const API_URL = import.meta.env.VITE_API_URL;

export const useSmsGateways = () => {
  const queryClient = useQueryClient();

  const { data: gateways = [], isLoading, error } = useQuery({
    queryKey: ["sms-gateways"],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/api/sms-gateways`);
      if (!response.ok) throw new Error("Failed to fetch gateways");
      const result = await response.json();
      return result.data || [];
    },
  });

  const createGateway = useMutation({
    mutationFn: async (url: string) => {
      const response = await fetch(`${API_URL}/api/sms-gateways`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!response.ok) throw new Error("Failed to create gateway");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sms-gateways"] });
    },
  });

  const deleteGateway = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`${API_URL}/api/sms-gateways/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete gateway");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sms-gateways"] });
    },
  });

  return {
    gateways,
    isLoading,
    error,
    createGateway: createGateway.mutate,
    deleteGateway: deleteGateway.mutate,
    isCreating: createGateway.isPending,
    isDeleting: deleteGateway.isPending,
  };
};

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:2003";

export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "operator" | "viewer";
  is_active: boolean;
  created_at?: string;
  last_login?: string | null;
}

export const useUsers = () => {
  const token = localStorage.getItem("authToken");

  return useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const response = await fetch(`${apiUrl}/api/users`, {
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch users");
      }

      const result = await response.json();
      return result.data as User[];
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  });
};

export const useCreateUser = () => {
  const queryClient = useQueryClient();
  const token = localStorage.getItem("authToken");

  return useMutation({
    mutationFn: async (data: {
      email: string;
      password: string;
      name?: string;
      role?: "operator" | "viewer";
    }) => {
      const response = await fetch(`${apiUrl}/api/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "Failed to create user");
      }

      const result = await response.json();
      return result.data as User;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("User created successfully");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to create user");
    },
  });
};

export const useDeleteUser = () => {
  const queryClient = useQueryClient();
  const token = localStorage.getItem("authToken");

  return useMutation({
    mutationFn: async (userId: string) => {
      const response = await fetch(`${apiUrl}/api/users/${userId}`, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "Failed to delete user");
      }

      return userId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("User deleted successfully");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete user");
    },
  });
};

export const useUpdateUser = () => {
  const queryClient = useQueryClient();
  const token = localStorage.getItem("authToken");

  return useMutation({
    mutationFn: async (data: { userId: string; updates: Partial<User> }) => {
      const response = await fetch(`${apiUrl}/api/users/${data.userId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify(data.updates),
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "Failed to update user");
      }

      const result = await response.json();
      return result.data as User;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("User updated successfully");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update user");
    },
  });
};

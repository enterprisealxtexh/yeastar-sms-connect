import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

const apiUrl = import.meta.env.VITE_API_URL;

export interface UserProfile {
  id: string;
  email: string;
  name?: string;
  role: "admin" | "operator" | "viewer";
  is_active: boolean;
  created_at: string;
}

export interface UpdateProfileData {
  email?: string;
  name?: string;
  password?: string;
  oldPassword?: string;
}

export const useUserProfile = () => {
  const token = localStorage.getItem("authToken");
  const storedUser = localStorage.getItem("user");
  const currentUser = storedUser ? JSON.parse(storedUser) : null;

  // Fetch current user profile
  const { data: profile, isLoading, error, refetch } = useQuery({
    queryKey: ["user-profile"],
    queryFn: async () => {
      const response = await fetch(`${apiUrl}/api/users/profile/me`, {
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        // If profile endpoint not available, use stored user data
        if (currentUser) {
          return currentUser as UserProfile;
        }
        throw new Error("Failed to fetch profile");
      }

      const result = await response.json();
      return result.data as UserProfile;
    },
    enabled: !!token,
    // Initialize with stored user data
    initialData: currentUser as UserProfile || undefined,
  });

  // Update profile mutation
  const updateMutation = useMutation({
    mutationFn: async (data: UpdateProfileData) => {
      const response = await fetch(`${apiUrl}/api/users/profile/me`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "Failed to update profile");
      }

      const result = await response.json();
      return result.data as UserProfile;
    },
    onSuccess: (data) => {
      toast.success("Profile updated successfully");
      refetch();
      // Update stored user data
      localStorage.setItem("user", JSON.stringify({
        id: data.id,
        email: data.email,
        name: data.name,
        role: data.role,
        is_active: data.is_active,
      }));
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Failed to update profile";
      toast.error(message);
    },
  });

  return {
    profile,
    isLoading,
    error,
    updateProfile: updateMutation.mutate,
    isUpdating: updateMutation.isPending,
  };
};

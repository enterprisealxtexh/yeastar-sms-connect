import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { usersApi } from "@/lib/api-client";

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
      const result = await usersApi.profile().catch(() => null);
      if (!result?.data) {
        if (currentUser) return currentUser as UserProfile;
        throw new Error("Failed to fetch profile");
      }
      return result.data as UserProfile;
    },
    enabled: !!token,
    // Initialize with stored user data
    initialData: currentUser as UserProfile || undefined,
  });

  // Update profile mutation
  const updateMutation = useMutation({
    mutationFn: async (data: UpdateProfileData) => {
      const result = await usersApi.updateProfile(data);
      if (!result.success) throw new Error(result.error || "Failed to update profile");
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

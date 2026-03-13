import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:2003';

// Equivalent of supabase.auth.getUser() — reads from localStorage session
const getLocalUser = () => {
  try {
    const stored = localStorage.getItem('user');
    const token = localStorage.getItem('authToken');
    if (!stored || !token) return null;
    return { ...JSON.parse(stored), token };
  } catch {
    return null;
  }
};

const authHeaders = () => {
  const token = localStorage.getItem('authToken');
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' };
};

export type AppRole = "super_admin" | "admin" | "operator" | "viewer";

export interface UserWithRole {
  user_id: string;
  email: string;
  role: AppRole;
  created_at: string;
}

const ROLE_LABELS: Record<AppRole, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  operator: "Operator",
  viewer: "Viewer",
};

const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  super_admin: "Full system access, role management, all admin powers",
  admin: "Manage agents, shifts, configuration, and system settings",
  operator: "Manage calls, contacts, SIM config, and daily operations",
  viewer: "Read-only access to dashboard, calls, and reports",
};

const ROLE_COLORS: Record<AppRole, string> = {
  super_admin: "bg-chart-5 text-white",
  admin: "bg-primary text-primary-foreground",
  operator: "bg-chart-2 text-white",
  viewer: "bg-muted text-muted-foreground",
};

export const ROLE_META = { labels: ROLE_LABELS, descriptions: ROLE_DESCRIPTIONS, colors: ROLE_COLORS };

// Equivalent of: supabase.from("user_roles").select() + supabase.functions.invoke("get-users-list")
export const useUsersWithRoles = () => {
  return useQuery({
    queryKey: ["users-with-roles"],
    queryFn: async (): Promise<UserWithRole[]> => {
      const resp = await fetch(`${API_URL}/api/users`, { headers: authHeaders() });
      if (!resp.ok) throw new Error(`Failed to fetch users: ${resp.status}`);
      const json = await resp.json();
      if (!json?.success || !Array.isArray(json.users)) throw new Error('Invalid response');
      return json.users.map((u: any) => ({
        user_id: u.id,
        email: u.email,
        role: (u.role || 'operator') as AppRole,
        created_at: u.created_at,
      }));
    },
  });
};

// Equivalent of: supabase.auth.getUser() + supabase.from("user_roles").select("role")
export const useCurrentUserRole = () => {
  return useQuery({
    queryKey: ["current-user-role"],
    queryFn: async (): Promise<AppRole | null> => {
      const localUser = getLocalUser();
      if (!localUser) return null;

      const resp = await fetch(`${API_URL}/api/users`, { headers: authHeaders() });
      if (!resp.ok) return null;
      const json = await resp.json();
      if (!json?.success || !Array.isArray(json.users)) return null;

      const match = json.users.find((u: any) => u.email === localUser.email);
      return (match?.role as AppRole) || null;
    },
  });
};

// Equivalent of: supabase.from("user_roles").update({ role }).eq("user_id", userId)
export const useUpdateUserRole = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      const resp = await fetch(`${API_URL}/api/users/${userId}/role`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ role }),
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        throw new Error(j?.error || 'Failed to update role');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users-with-roles"] });
      toast.success("Role updated");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to update role");
    },
  });
};

export interface CreateUserInput {
  email: string;
  password: string;
  role: AppRole;
  full_name: string;
}

// Equivalent of: supabase.functions.invoke("create-user", { body: input })
export const useCreateUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateUserInput) => {
      const resp = await fetch(`${API_URL}/api/users`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          email: input.email,
          password: input.password,
          name: input.full_name,
          role: input.role,
        }),
      });
      const json = await resp.json();
      if (!resp.ok || json?.error) throw new Error(json?.error || 'Failed to create user');
      return json;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["users-with-roles"] });
      toast.success(`User ${variables.email} created successfully. Initial password shared separately.`, {
        duration: 10000,
      });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to create user");
    },
  });
};

// DELETE /api/users/:id (super_admin only)
export const useDeleteUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const resp = await fetch(`${API_URL}/api/users/${userId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const json = await resp.json();
      if (!resp.ok || !json?.success) throw new Error(json?.error || 'Failed to delete user');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users-with-roles"] });
      toast.success("User deleted");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to delete user");
    },
  });
};

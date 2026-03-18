import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./useAuth";
import { usersApi } from "@/lib/api-client";

export interface UserPermissions {
  ports: number[];      // Empty = all ports (no restrictions). When set, these are the ONLY ports allowed.
  extensions: string[]; // Empty = all extensions (no restrictions). When set, these are the ONLY extensions allowed.
}

/**
 * Fetches granular port and extension permissions for non-admin users.
 * 
 * Permission Logic:
 * - Admins: Always have full access (empty arrays = no restrictions)
 * - Non-Admins with NO granular permissions: Full access (empty arrays = no restrictions)
 * - Non-Admins WITH granular permissions: Access ONLY to specified ports/extensions
 * 
 * Role-based permissions (admin, operator, viewer) are enforced server-side.
 * This hook only retrieves granular restrictions applied to a specific user.
 */
export const useUserPermissions = () => {
  const { user, isAdmin } = useAuth();
  const token = localStorage.getItem('authToken');

  return useQuery({
    queryKey: ['user-permissions', user?.id],
    queryFn: async (): Promise<UserPermissions> => {
      // Admins and superadmins have no restrictions
      if (isAdmin) {
        return { ports: [], extensions: [] };
      }

      // Fetch permissions for non-admin users
      if (!user?.id || !token) {
        return { ports: [], extensions: [] };
      }

      const [portsData, extensionsData] = await Promise.all([
        usersApi.portPermissions(user.id).catch(() => ({ data: [] })),
        usersApi.extensionPermissions(user.id).catch(() => ({ data: [] })),
      ]);
      return {
        ports: (portsData as any)?.data || [],
        extensions: (extensionsData as any)?.data || [],
      };
    },
    staleTime: 1000 * 60 * 5,
    enabled: !!user,
  });
};

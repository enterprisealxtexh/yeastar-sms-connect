import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./useAuth";

const apiUrl = import.meta.env.VITE_API_URL;

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

      try {
        const [portsRes, extensionsRes] = await Promise.all([
          fetch(`${apiUrl}/api/users/${user.id}/port-permissions`, {
            headers: { 'Authorization': `Bearer ${token}` }
          }),
          fetch(`${apiUrl}/api/users/${user.id}/extension-permissions`, {
            headers: { 'Authorization': `Bearer ${token}` }
          })
        ]);

        const portsData = portsRes.ok ? await portsRes.json() : { data: [] };
        const extensionsData = extensionsRes.ok ? await extensionsRes.json() : { data: [] };

        // Return empty array if no restrictions set (meaning all access allowed)
        // Return specific ports/extensions if restrictions are set
        return {
          ports: portsData.data || [],
          extensions: extensionsData.data || []
        };
      } catch (error) {
        console.error('Failed to fetch user permissions:', error);
        // On error, fall back to no restrictions (safer to allow access than block)
        return { ports: [], extensions: [] };
      }
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    enabled: !!user,
  });
};

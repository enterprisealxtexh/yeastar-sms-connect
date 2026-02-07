import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Returns a Map of phone_number → contact_name for quick lookups.
 * Reuses the "contacts" query key so it shares cache with useContacts.
 */
export const useContactLookup = () => {
  const { data: contacts } = useQuery({
    queryKey: ["contacts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contacts")
        .select("phone_number, name")
        .not("name", "is", null);

      if (error) throw error;
      return data || [];
    },
    staleTime: 60_000, // Cache for 1 minute
  });

  const lookup = useMemo(() => {
    const map = new Map<string, string>();
    if (contacts) {
      for (const c of contacts) {
        if (c.name) {
          map.set(c.phone_number, c.name);
        }
      }
    }
    return map;
  }, [contacts]);

  /** Resolve a phone number to a contact name, or return null */
  const getContactName = (phoneNumber: string): string | null => {
    return lookup.get(phoneNumber) ?? null;
  };

  return { getContactName, lookup };
};

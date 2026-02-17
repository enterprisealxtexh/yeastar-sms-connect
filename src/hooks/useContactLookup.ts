import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

/**
 * Contact lookup - not available in local SQLite mode
 */
export const useContactLookup = () => {
  const { data: contacts = [] } = useQuery({
    queryKey: ["contacts"],
    queryFn: async () => {
      // Contacts table not available in local SQLite mode
      return [];
    },
    staleTime: 60_000, // Cache for 1 minute
  });

  const lookup = useMemo(() => {
    const map = new Map<string, string>();
    // In local mode, no contacts available
    return map;
  }, [contacts]);

  /** Resolve a phone number to a contact name, or return null */
  const getContactName = (phoneNumber: string): string | null => {
    // In local mode, just return the phone number
    return phoneNumber;
  };

  return { getContactName, lookup };
};

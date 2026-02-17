import { useState } from "react";
import { toast } from "sonner";

/**
 * Google Contacts sync requires cloud infrastructure and OAuth authentication.
 * This feature is not available in the local SQLite setup.
 */
export const useGoogleContacts = () => {
  const [isImporting] = useState(false);
  const [isPushing] = useState(false);
  const [isMerging] = useState(false);

  const importFromGoogle = async () => {
    toast.error("Google Contacts import is not available in local SQLite mode");
  };

  const pushToGoogle = async () => {
    toast.error("Google Contacts push is not available in local SQLite mode");
  };

  const mergeDuplicates = async () => {
    toast.error("Contact merging is not available in local SQLite mode");
  };

  return {
    importFromGoogle,
    isImporting,
    pushToGoogle,
    isPushing,
    mergeDuplicates,
    isMerging,
  };
};

import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { contactsApi } from "@/lib/api-client";

const GOOGLE_TOKEN_KEY = "google_contacts_token";

/**
 * Check if we have a valid Google token stored locally
 */
function getStoredGoogleToken(): string | null {
  return localStorage.getItem(GOOGLE_TOKEN_KEY);
}

/**
 * Store Google token locally
 */
function storeGoogleToken(token: string): void {
  localStorage.setItem(GOOGLE_TOKEN_KEY, token);
}

/**
 * Clear stored Google token
 */
function clearGoogleToken(): void {
  localStorage.removeItem(GOOGLE_TOKEN_KEY);
}

export const useGoogleContacts = () => {
  const [isImporting, setIsImporting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<"import" | "push" | null>(null);
  const queryClient = useQueryClient();

  // Listen for OAuth callback from popup
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Verify origin for security
      if (event.origin !== window.location.origin) return;
      
      if (event.data.type === "GOOGLE_AUTH_SUCCESS" && event.data.token) {
        storeGoogleToken(event.data.token);
        toast.success("Connected to Google");
        setShowAuthModal(false);
        
        // Execute pending action if any
        if (pendingAction === "import") {
          performImport(event.data.token);
        } else if (pendingAction === "push") {
          performPush(event.data.token);
        }
        setPendingAction(null);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [pendingAction]);

  const performImport = async (token: string) => {
    setIsImporting(true);
    try {
      const result = await contactsApi.importFromGoogle(token);
      if (!result.success) {
        if (result.error?.includes('401') || result.error?.includes('token')) {
          clearGoogleToken();
          setPendingAction("import");
          setShowAuthModal(true);
          throw new Error("Google token invalid or expired. Please authenticate again.");
        }
        throw new Error(result.error || "Failed to import Google contacts");
      }
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast.success(`Imported ${result.data?.imported} contacts from Google (${result.data?.total_found} found)`);
    } catch (error) {
      if (!(error instanceof Error && error.message.includes("authenticated"))) {
        toast.error(error instanceof Error ? error.message : "Failed to import Google contacts");
      }
    } finally {
      setIsImporting(false);
    }
  };

  const performPush = async (token: string) => {
    setIsPushing(true);
    try {
      const result = await contactsApi.pushToGoogle(token);
      if (!result.success) {
        if (result.error?.includes('401') || result.error?.includes('token')) {
          clearGoogleToken();
          setPendingAction("push");
          setShowAuthModal(true);
          throw new Error("Google token invalid or expired. Please authenticate again.");
        }
        throw new Error(result.error || "Failed to push contacts");
      }
      toast.success(`Pushed to Google: ${result.data?.created} created, ${result.data?.updated} updated, ${result.data?.skipped} skipped`);
    } catch (error) {
      if (!(error instanceof Error && error.message.includes("authenticated"))) {
        toast.error(error instanceof Error ? error.message : "Failed to push contacts to Google");
      }
    } finally {
      setIsPushing(false);
    }
  };

  const importFromGoogle = async () => {
    const authToken = getStoredGoogleToken();

    if (!authToken) {
      setPendingAction("import");
      setShowAuthModal(true);
      return;
    }

    await performImport(authToken);
  };

  const pushToGoogle = async () => {
    const authToken = getStoredGoogleToken();

    if (!authToken) {
      setPendingAction("push");
      setShowAuthModal(true);
      return;
    }

    await performPush(authToken);
  };

  const mergeDuplicates = async () => {
    setIsMerging(true);
    try {
      const result = await contactsApi.merge();
      if (!result.success) throw new Error(result.error || "Failed to merge duplicates");
      const merged = result.data?.merged ?? 0;
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      if (merged === 0) {
        toast.info("No duplicate contacts found");
      } else {
        toast.success(`Merged ${merged} duplicate contacts`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to merge duplicates");
    } finally {
      setIsMerging(false);
    }
  };

  return {
    importFromGoogle,
    isImporting,
    pushToGoogle,
    isPushing,
    mergeDuplicates,
    isMerging,
    showAuthModal,
    setShowAuthModal,
    storeGoogleToken,
  };
};


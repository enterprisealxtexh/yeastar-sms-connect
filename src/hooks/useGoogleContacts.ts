import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const apiUrl = import.meta.env.VITE_API_URL;
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
      const response = await fetch(`${apiUrl}/api/contacts/import-from-google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ googleToken: token }),
      });

      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401) {
          clearGoogleToken();
          setPendingAction("import");
          setShowAuthModal(true);
          throw new Error("Google token invalid or expired. Please authenticate again.");
        }
        throw new Error(data.error || `Failed to fetch contacts (${response.status})`);
      }

      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast.success(
        `Imported ${data.imported} contacts from Google (${data.total_found} found)`
      );
    } catch (error) {
      console.error("Google contacts import error:", error);
      if (!(error instanceof Error && error.message.includes("authenticated"))) {
        toast.error(
          error instanceof Error ? error.message : "Failed to import Google contacts"
        );
      }
    } finally {
      setIsImporting(false);
    }
  };

  const performPush = async (token: string) => {
    setIsPushing(true);
    try {
      const response = await fetch(`${apiUrl}/api/contacts/push-to-google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ googleToken: token }),
      });

      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401) {
          clearGoogleToken();
          setPendingAction("push");
          setShowAuthModal(true);
          throw new Error("Google token invalid or expired. Please authenticate again.");
        }
        throw new Error(data.error || `Failed to push contacts (${response.status})`);
      }

      toast.success(
        `Pushed to Google: ${data.created} created, ${data.updated} updated, ${data.skipped} skipped`
      );
    } catch (error) {
      console.error("Google contacts push error:", error);
      if (!(error instanceof Error && error.message.includes("authenticated"))) {
        toast.error(
          error instanceof Error ? error.message : "Failed to push contacts to Google"
        );
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
      const response = await fetch(`${apiUrl}/api/contacts/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) throw new Error('Failed to merge duplicates');
      const data = await response.json();
      const merged = data.data?.merged ?? 0;

      queryClient.invalidateQueries({ queryKey: ["contacts"] });

      if (merged === 0) {
        toast.info("No duplicate contacts found");
      } else {
        toast.success(`Merged ${merged} duplicate contacts`);
      }
    } catch (error) {
      console.error("Merge duplicates error:", error);
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


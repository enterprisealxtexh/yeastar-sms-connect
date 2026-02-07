import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

/** Ensures Google OAuth with read/write contacts scope, returns provider_token or null */
async function ensureGoogleAuth(): Promise<{ providerToken: string; accessToken: string } | null> {
  // Check if we already have a provider token from an existing session
  const { data: existingSession } = await supabase.auth.getSession();
  if (existingSession?.session?.provider_token) {
    return {
      providerToken: existingSession.session.provider_token,
      accessToken: existingSession.session.access_token,
    };
  }

  // Need to sign in with Google
  const result = await lovable.auth.signInWithOAuth("google", {
    redirect_uri: window.location.origin,
    extraParams: {
      scope: "https://www.googleapis.com/auth/contacts",
      access_type: "offline",
      prompt: "consent",
    },
  });

  if (result.redirected) return null;
  if (result.error) throw result.error;

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session?.provider_token) {
    throw new Error("Could not get Google access token. Please try again.");
  }

  return {
    providerToken: sessionData.session.provider_token,
    accessToken: sessionData.session.access_token,
  };
}

export const useGoogleContacts = () => {
  const [isImporting, setIsImporting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const queryClient = useQueryClient();

  const importFromGoogle = async () => {
    setIsImporting(true);
    try {
      const auth = await ensureGoogleAuth();
      if (!auth) return; // Redirected for OAuth

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fetch-google-contacts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.accessToken}`,
          },
          body: JSON.stringify({ provider_token: auth.providerToken, action: "fetch" }),
        }
      );

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Failed to fetch contacts (${response.status})`);

      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast.success(`Imported ${data.imported} contacts from Google (${data.total_found} found)`);
    } catch (error) {
      console.error("Google contacts import error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to import Google contacts");
    } finally {
      setIsImporting(false);
    }
  };

  const pushToGoogle = async () => {
    setIsPushing(true);
    try {
      const auth = await ensureGoogleAuth();
      if (!auth) return; // Redirected for OAuth

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fetch-google-contacts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.accessToken}`,
          },
          body: JSON.stringify({ provider_token: auth.providerToken, action: "push" }),
        }
      );

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Failed to push contacts (${response.status})`);

      toast.success(
        `Pushed to Google: ${data.created} created, ${data.updated} updated, ${data.skipped} skipped`
      );
    } catch (error) {
      console.error("Google contacts push error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to push contacts to Google");
    } finally {
      setIsPushing(false);
    }
  };

  const mergeDuplicates = async () => {
    setIsMerging(true);
    try {
      const { data, error } = await supabase.rpc("merge_duplicate_contacts");

      if (error) throw error;

      const result = data as { merged: number } | null;
      const merged = result?.merged ?? 0;

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
  };
};

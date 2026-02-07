import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const GOOGLE_TOKEN_KEY = "google_provider_token";

/** Capture the provider_token from auth events and persist it */
function useGoogleTokenCapture() {
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.provider_token) {
        sessionStorage.setItem(GOOGLE_TOKEN_KEY, session.provider_token);
      }
    });

    // Also check current session on mount
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session?.provider_token) {
        sessionStorage.setItem(GOOGLE_TOKEN_KEY, data.session.provider_token);
      }
    });

    return () => subscription.unsubscribe();
  }, []);
}

/** Get a valid Google provider token, re-auth if needed */
async function ensureGoogleAuth(): Promise<{ providerToken: string; accessToken: string } | null> {
  // 1. Check sessionStorage first (most reliable)
  const storedToken = sessionStorage.getItem(GOOGLE_TOKEN_KEY);
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;

  if (storedToken && accessToken) {
    // Verify the token is still valid by making a lightweight request
    const testResp = await fetch(
      "https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=" + storedToken
    );
    if (testResp.ok) {
      return { providerToken: storedToken, accessToken };
    }
    // Token expired — clear it
    sessionStorage.removeItem(GOOGLE_TOKEN_KEY);
  }

  // 2. Check if session has it (right after OAuth callback)
  if (sessionData?.session?.provider_token && accessToken) {
    sessionStorage.setItem(GOOGLE_TOKEN_KEY, sessionData.session.provider_token);
    return {
      providerToken: sessionData.session.provider_token,
      accessToken,
    };
  }

  // 3. Need to re-authenticate with Google to get a fresh provider_token
  const result = await lovable.auth.signInWithOAuth("google", {
    redirect_uri: window.location.origin,
    extraParams: {
      scope: "https://www.googleapis.com/auth/contacts",
      access_type: "offline",
      prompt: "consent",
    },
  });

  if (result.redirected) return null; // Page will redirect, caller should bail
  if (result.error) throw result.error;

  // After redirect back, session should have the token
  const { data: newSession } = await supabase.auth.getSession();
  if (newSession?.session?.provider_token) {
    sessionStorage.setItem(GOOGLE_TOKEN_KEY, newSession.session.provider_token);
    return {
      providerToken: newSession.session.provider_token,
      accessToken: newSession.session.access_token,
    };
  }

  throw new Error("Could not get Google access token after re-authentication. Please sign out and sign in again with Google.");
}

export const useGoogleContacts = () => {
  const [isImporting, setIsImporting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const queryClient = useQueryClient();

  // Capture Google token from auth events
  useGoogleTokenCapture();

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

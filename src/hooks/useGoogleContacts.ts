import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const useGoogleContacts = () => {
  const [isImporting, setIsImporting] = useState(false);
  const queryClient = useQueryClient();

  const importFromGoogle = async () => {
    setIsImporting(true);

    try {
      // Step 1: Sign in with Google requesting contacts scope
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
        extraParams: {
          scope: "https://www.googleapis.com/auth/contacts.readonly",
          access_type: "offline",
          prompt: "consent",
        },
      });

      // If redirected, the flow will continue after redirect
      if (result.redirected) {
        return;
      }

      if (result.error) {
        throw result.error;
      }

      // Step 2: Get the provider token from the session
      const { data: sessionData } = await supabase.auth.getSession();
      const providerToken = sessionData?.session?.provider_token;

      if (!providerToken) {
        toast.error("Could not get Google access token. Please try again.");
        setIsImporting(false);
        return;
      }

      // Step 3: Call the edge function with the provider token
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fetch-google-contacts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionData.session?.access_token}`,
          },
          body: JSON.stringify({ provider_token: providerToken }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Failed to fetch contacts (${response.status})`);
      }

      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast.success(`Imported ${data.imported} contacts from Google (${data.total_found} found)`);
    } catch (error) {
      console.error("Google contacts import error:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to import Google contacts"
      );
    } finally {
      setIsImporting(false);
    }
  };

  return { importFromGoogle, isImporting };
};

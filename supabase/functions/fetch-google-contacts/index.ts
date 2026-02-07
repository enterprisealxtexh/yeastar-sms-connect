import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GOOGLE_PEOPLE_API = "https://people.googleapis.com/v1";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get the provider token from the request body
    const body = await req.json().catch(() => ({}));
    const { provider_token } = body;

    if (!provider_token) {
      return new Response(
        JSON.stringify({ error: "Missing provider_token. Please sign in with Google first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch contacts from Google People API
    const contacts: Array<{ phone_number: string; name: string }> = [];
    let nextPageToken: string | undefined;

    do {
      const url = new URL(`${GOOGLE_PEOPLE_API}/people/me/connections`);
      url.searchParams.set("personFields", "names,phoneNumbers");
      url.searchParams.set("pageSize", "1000");
      if (nextPageToken) {
        url.searchParams.set("pageToken", nextPageToken);
      }

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${provider_token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error("Google People API error:", response.status, errorData);
        return new Response(
          JSON.stringify({
            error: `Google API error (${response.status}). Make sure the contacts scope was granted.`,
            details: errorData,
          }),
          { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = await response.json();

      if (data.connections) {
        for (const person of data.connections) {
          const name =
            person.names?.[0]?.displayName || "";
          const phones = person.phoneNumbers || [];

          for (const phone of phones) {
            if (phone.value) {
              // Normalize phone number: remove spaces and dashes
              const normalized = phone.value.replace(/[\s\-()]/g, "");
              contacts.push({
                phone_number: normalized,
                name: name,
              });
            }
          }
        }
      }

      nextPageToken = data.nextPageToken;
    } while (nextPageToken);

    // Upsert contacts into the database
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    let imported = 0;
    for (const contact of contacts) {
      if (!contact.phone_number) continue;

      const { error } = await supabase.from("contacts").upsert(
        {
          phone_number: contact.phone_number,
          name: contact.name || null,
          source: "google",
        },
        { onConflict: "phone_number" }
      );

      if (!error) imported++;
    }

    return new Response(
      JSON.stringify({
        success: true,
        total_found: contacts.length,
        imported,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error fetching Google contacts:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

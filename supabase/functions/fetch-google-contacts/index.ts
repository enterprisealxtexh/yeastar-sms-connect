import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GOOGLE_PEOPLE_API = "https://people.googleapis.com/v1";

interface LocalContact {
  id: string;
  phone_number: string;
  name: string | null;
  notes: string | null;
  sms_count: number;
  call_count: number;
}

// Normalize phone number for comparison
function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-\(\)\.]/g, "");
}

// Fetch all existing Google contacts (phone → resourceName map)
async function fetchGoogleContacts(providerToken: string): Promise<Map<string, { resourceName: string; etag: string; name: string }>> {
  const map = new Map<string, { resourceName: string; etag: string; name: string }>();
  let nextPageToken: string | undefined;

  do {
    const url = new URL(`${GOOGLE_PEOPLE_API}/people/me/connections`);
    url.searchParams.set("personFields", "names,phoneNumbers");
    url.searchParams.set("pageSize", "1000");
    if (nextPageToken) url.searchParams.set("pageToken", nextPageToken);

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${providerToken}` },
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Google API list error:", response.status, errText);
      break;
    }

    const data = await response.json();
    if (data.connections) {
      for (const person of data.connections) {
        const phones = person.phoneNumbers || [];
        const displayName = person.names?.[0]?.displayName || "";
        for (const phone of phones) {
          if (phone.value) {
            map.set(normalizePhone(phone.value), {
              resourceName: person.resourceName,
              etag: person.etag,
              name: displayName,
            });
          }
        }
      }
    }
    nextPageToken = data.nextPageToken;
  } while (nextPageToken);

  console.log(`Fetched ${map.size} existing Google contacts`);
  return map;
}

// Create a new contact in Google
async function createGoogleContact(providerToken: string, contact: LocalContact): Promise<boolean> {
  const body = {
    names: contact.name ? [{ givenName: contact.name }] : [],
    phoneNumbers: [{ value: contact.phone_number, type: "mobile" }],
  };

  const response = await fetch(`${GOOGLE_PEOPLE_API}/people:createContact`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${providerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`Failed to create contact ${contact.phone_number}:`, response.status, errText);
    return false;
  }

  console.log(`Created Google contact: ${contact.phone_number} (${contact.name || "no name"})`);
  return true;
}

// Update an existing Google contact
async function updateGoogleContact(
  providerToken: string,
  resourceName: string,
  etag: string,
  contact: LocalContact
): Promise<boolean> {
  const body = {
    etag,
    names: contact.name ? [{ givenName: contact.name }] : [],
    phoneNumbers: [{ value: contact.phone_number, type: "mobile" }],
  };

  const url = `${GOOGLE_PEOPLE_API}/${resourceName}:updateContact?updatePersonFields=names,phoneNumbers`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${providerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`Failed to update contact ${contact.phone_number}:`, response.status, errText);
    return false;
  }

  console.log(`Updated Google contact: ${contact.phone_number}`);
  return true;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { provider_token, action = "fetch" } = body;

    if (!provider_token) {
      return new Response(
        JSON.stringify({ error: "Missing provider_token. Please sign in with Google first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // ── FETCH (import from Google → local DB) ──
    if (action === "fetch") {
      const googleContacts: Array<{ phone_number: string; name: string }> = [];
      let nextPageToken: string | undefined;

      do {
        const url = new URL(`${GOOGLE_PEOPLE_API}/people/me/connections`);
        url.searchParams.set("personFields", "names,phoneNumbers");
        url.searchParams.set("pageSize", "1000");
        if (nextPageToken) url.searchParams.set("pageToken", nextPageToken);

        const response = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${provider_token}` },
        });

        if (!response.ok) {
          const errorData = await response.text();
          console.error("Google People API error:", response.status, errorData);
          return new Response(
            JSON.stringify({ error: `Google API error (${response.status}). Make sure the contacts scope was granted.`, details: errorData }),
            { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const data = await response.json();
        if (data.connections) {
          for (const person of data.connections) {
            const name = person.names?.[0]?.displayName || "";
            for (const phone of (person.phoneNumbers || [])) {
              if (phone.value) {
                googleContacts.push({ phone_number: normalizePhone(phone.value), name });
              }
            }
          }
        }
        nextPageToken = data.nextPageToken;
      } while (nextPageToken);

      let imported = 0;
      for (const contact of googleContacts) {
        if (!contact.phone_number) continue;
        const { error } = await supabase.from("contacts").upsert(
          { phone_number: contact.phone_number, name: contact.name || null, source: "google" },
          { onConflict: "phone_number" }
        );
        if (!error) imported++;
      }

      return new Response(
        JSON.stringify({ success: true, action: "fetch", total_found: googleContacts.length, imported }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── PUSH (export local contacts → Google, merge duplicates) ──
    if (action === "push") {
      // Step 1: Get all local contacts
      const { data: localContacts, error: dbError } = await supabase
        .from("contacts")
        .select("id, phone_number, name, notes, sms_count, call_count")
        .order("last_seen_at", { ascending: false });

      if (dbError) {
        console.error("DB error fetching contacts:", dbError);
        return new Response(
          JSON.stringify({ error: "Failed to fetch local contacts" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`Found ${localContacts?.length || 0} local contacts to push`);

      // Step 2: Fetch existing Google contacts for dedup
      const existingGoogle = await fetchGoogleContacts(provider_token);

      let created = 0;
      let updated = 0;
      let skipped = 0;

      for (const contact of (localContacts || [])) {
        const normalized = normalizePhone(contact.phone_number);
        const existing = existingGoogle.get(normalized);

        if (existing) {
          // Contact exists in Google — update if our local name is better
          if (contact.name && contact.name !== existing.name) {
            const ok = await updateGoogleContact(provider_token, existing.resourceName, existing.etag, contact);
            if (ok) updated++;
            else skipped++;
          } else {
            skipped++;
          }
        } else {
          // New contact — create in Google
          const ok = await createGoogleContact(provider_token, contact);
          if (ok) created++;
          else skipped++;
        }

        // Rate limiting: Google People API has 90 requests/min for mutations
        if ((created + updated) % 30 === 0 && (created + updated) > 0) {
          console.log(`Rate limit pause after ${created + updated} mutations...`);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }

      return new Response(
        JSON.stringify({ success: true, action: "push", created, updated, skipped, total: localContacts?.length || 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}. Use 'fetch' or 'push'.` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in fetch-google-contacts:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

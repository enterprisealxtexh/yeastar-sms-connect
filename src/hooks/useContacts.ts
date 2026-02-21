import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export interface Contact {
  id: string;
  phone_number: string;
  name: string | null;
  source: string;
  first_seen_at: string;
  last_seen_at: string;
  sms_count: number;
  call_count: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const apiUrl = import.meta.env.VITE_API_URL;

export const useContacts = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const query = useQuery({
    queryKey: ["contacts"],
    queryFn: async (): Promise<Contact[]> => {
      const response = await fetch(`${apiUrl}/api/contacts`);
      if (!response.ok) throw new Error('Failed to fetch contacts');
      const data = await response.json();
      return data.data || [];
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const updateContact = useMutation({
    mutationFn: async ({ id, name, notes }: { id: string; name?: string; notes?: string }) => {
      const response = await fetch(`${apiUrl}/api/contacts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, notes }),
      });
      if (!response.ok) throw new Error('Failed to update contact');
      const data = await response.json();
      return data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast({
        title: "Success",
        description: "Contact updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const importContacts = useMutation({
    mutationFn: async (contacts: { phone_number: string; name: string }[]) => {
      const response = await fetch(`${apiUrl}/api/contacts/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contacts }),
      });
      if (!response.ok) throw new Error('Failed to import contacts');
      const data = await response.json();
      return data.data.imported;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      toast({
        title: "Import Complete",
        description: `${count} contacts imported successfully.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Import Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return {
    ...query,
    updateContact,
    importContacts,
  };
};

// Google Contacts CSV export format
export function contactsToGoogleCSV(contacts: Contact[]): string {
  const headers = [
    "Name",
    "Given Name",
    "Additional Name",
    "Family Name",
    "Yomi Name",
    "Given Name Yomi",
    "Additional Name Yomi",
    "Family Name Yomi",
    "Name Prefix",
    "Name Suffix",
    "Initials",
    "Nickname",
    "Short Name",
    "Maiden Name",
    "Birthday",
    "Gender",
    "Location",
    "Billing Information",
    "Directory Server",
    "Mileage",
    "Occupation",
    "Hobby",
    "Sensitivity",
    "Priority",
    "Subject",
    "Notes",
    "Language",
    "Photo",
    "Group Membership",
    "Phone 1 - Type",
    "Phone 1 - Value",
  ];

  const rows = contacts.map((c) => {
    const name = c.name || c.phone_number;
    const notes = c.notes || `SMS: ${c.sms_count}, Calls: ${c.call_count}`;
    const values = [
      name,        // Name
      name,        // Given Name
      "",          // Additional Name
      "",          // Family Name
      "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "",
      notes,       // Notes
      "",          // Language
      "",          // Photo
      "* myContacts", // Group Membership
      "Mobile",    // Phone 1 - Type
      c.phone_number, // Phone 1 - Value
    ];
    return values.map((v) => `"${(v || "").replace(/"/g, '""')}"`).join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}

export function parseGoogleCSV(csvText: string): { phone_number: string; name: string }[] {
  const lines = csvText.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine);

  const nameIdx = headers.findIndex((h) => h.trim().toLowerCase() === "name");
  const givenNameIdx = headers.findIndex((h) => h.trim().toLowerCase() === "given name");
  
  // Find phone columns (there can be multiple)
  const phoneValueIndices: number[] = [];
  headers.forEach((h, i) => {
    if (h.trim().toLowerCase().includes("phone") && h.trim().toLowerCase().includes("value")) {
      phoneValueIndices.push(i);
    }
  });

  const contacts: { phone_number: string; name: string }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const name = (values[nameIdx] || values[givenNameIdx] || "").trim();

    for (const idx of phoneValueIndices) {
      const phone = (values[idx] || "").trim();
      if (phone) {
        contacts.push({ phone_number: phone, name });
      }
    }
  }

  return contacts;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

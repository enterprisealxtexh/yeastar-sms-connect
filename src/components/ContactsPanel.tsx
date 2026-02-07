import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Users,
  Download,
  Upload,
  Search,
  Phone,
  MessageSquare,
  Edit2,
  Check,
  X,
} from "lucide-react";
import { useContacts, contactsToGoogleCSV, parseGoogleCSV, Contact } from "@/hooks/useContacts";
import { format } from "date-fns";

export const ContactsPanel = () => {
  const { data: contacts = [], isLoading, updateContact, importContacts } = useContacts();
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filtered = contacts.filter((c) => {
    const q = search.toLowerCase();
    return (
      c.phone_number.toLowerCase().includes(q) ||
      (c.name || "").toLowerCase().includes(q)
    );
  });

  const handleExport = () => {
    const csv = contactsToGoogleCSV(contacts);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `contacts_${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseGoogleCSV(text);
      if (parsed.length > 0) {
        importContacts.mutate(parsed);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const startEdit = (contact: Contact) => {
    setEditingId(contact.id);
    setEditName(contact.name || "");
  };

  const saveEdit = (id: string) => {
    updateContact.mutate({ id, name: editName });
    setEditingId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
  };

  return (
    <Card className="card-glow border-border/50 bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
              <Users className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold">
                Contacts
                <Badge variant="secondary" className="ml-2 text-xs">
                  {contacts.length}
                </Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Auto-saved from SMS &amp; call logs • Google Contacts CSV compatible
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-border/50"
              onClick={handleExport}
              disabled={contacts.length === 0}
            >
              <Download className="w-4 h-4" />
              Export CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-border/50"
              onClick={() => fileInputRef.current?.click()}
              disabled={importContacts.isPending}
            >
              <Upload className="w-4 h-4" />
              Import CSV
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleImport}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search contacts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-muted/50 border-border/50"
          />
        </div>

        <ScrollArea className="h-[500px]">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Loading contacts…</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              {search ? "No contacts match your search" : "No contacts yet — they'll appear automatically from SMS & calls"}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border/30">
                  <TableHead>Name</TableHead>
                  <TableHead>Phone Number</TableHead>
                  <TableHead className="text-center">
                    <MessageSquare className="w-4 h-4 inline" />
                  </TableHead>
                  <TableHead className="text-center">
                    <Phone className="w-4 h-4 inline" />
                  </TableHead>
                  <TableHead>Last Seen</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((contact) => (
                  <TableRow key={contact.id} className="border-border/20 hover:bg-muted/20">
                    <TableCell>
                      {editingId === contact.id ? (
                        <div className="flex items-center gap-1">
                          <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="h-7 text-sm w-32"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEdit(contact.id);
                              if (e.key === "Escape") cancelEdit();
                            }}
                          />
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => saveEdit(contact.id)}>
                            <Check className="w-3 h-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={cancelEdit}>
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      ) : (
                        <span className="font-medium text-sm">
                          {contact.name || <span className="text-muted-foreground italic">No name</span>}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{contact.phone_number}</TableCell>
                    <TableCell className="text-center text-sm">{contact.sms_count}</TableCell>
                    <TableCell className="text-center text-sm">{contact.call_count}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(contact.last_seen_at), "MMM d, HH:mm")}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs capitalize">
                        {contact.source}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {editingId !== contact.id && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => startEdit(contact)}
                        >
                          <Edit2 className="w-3 h-3" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

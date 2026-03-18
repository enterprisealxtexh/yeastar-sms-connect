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
  Loader2,
  Merge,
  ArrowUpToLine,
} from "lucide-react";
import { useContacts, contactsToGoogleCSV, parseGoogleCSV, Contact } from "@/hooks/useContacts";
import { useGoogleContacts } from "@/hooks/useGoogleContacts";
import { GoogleAuthModal } from "@/components/GoogleAuthModal";
import { format } from "date-fns";

export const ContactsPanel = () => {
  const { data: contacts = [], isLoading, updateContact, importContacts } = useContacts();
  const { 
    importFromGoogle, 
    isImporting: isGoogleImporting, 
    pushToGoogle, 
    isPushing, 
    mergeDuplicates, 
    isMerging,
    showAuthModal,
    setShowAuthModal,
    storeGoogleToken,
  } = useGoogleContacts();
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
                Auto-saved from SMS &amp; call logs • CSV compatible
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-border/50"
              onClick={importFromGoogle}
              disabled={isGoogleImporting}
            >
              {isGoogleImporting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
              )}
              Pull from Google
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-border/50"
              onClick={pushToGoogle}
              disabled={isPushing || contacts.length === 0}
            >
              {isPushing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowUpToLine className="w-4 h-4" />
              )}
              Push to Google
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-border/50"
              onClick={mergeDuplicates}
              disabled={isMerging}
            >
              {isMerging ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Merge className="w-4 h-4" />
              )}
              Merge Duplicates
            </Button>
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

      <GoogleAuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onAuthSuccess={storeGoogleToken}
        isLoading={isGoogleImporting || isPushing}
      />
    </Card>
  );
};

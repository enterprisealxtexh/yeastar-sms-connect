import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Users, Plus, Trash2, Edit, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "operator" | "viewer";
  is_active: boolean;
  created_at?: string;
  last_login?: string | null;
}

const apiUrl = import.meta.env.VITE_API_URL;

export const UserManager = () => {
  const { user: currentUser, role } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<"operator" | "viewer">("operator");
  const [selectedPorts, setSelectedPorts] = useState<number[]>([]);
  const [selectedExtensions, setSelectedExtensions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const token = localStorage.getItem("authToken");

  // Fetch users
  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`${apiUrl}/api/users`, {
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch users");
      }

      const result = await response.json();
      setUsers(result.data || []);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch users";
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateUser = async () => {
    if (!newEmail || !newPassword) {
      toast.error("Email and password are required");
      return;
    }

    try {
      setIsCreating(true);
      const response = await fetch(`${apiUrl}/api/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          email: newEmail,
          password: newPassword,
          name: newName,
          role: newRole,
        }),
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "Failed to create user");
      }

      const result = await response.json();
      const newUser = result.data;
      
      // Assign port and extension permissions if role is viewer and permissions are specified
      if (newRole === "viewer" && (selectedPorts.length > 0 || selectedExtensions.length > 0)) {
        if (selectedPorts.length > 0) {
          await fetch(`${apiUrl}/api/users/${newUser.id}/port-permissions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`,
            },
            body: JSON.stringify({ ports: selectedPorts }),
          });
        }
        
        if (selectedExtensions.length > 0) {
          await fetch(`${apiUrl}/api/users/${newUser.id}/extension-permissions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`,
            },
            body: JSON.stringify({ extensions: selectedExtensions }),
          });
        }
      }
      
      setUsers([...users, newUser]);
      setNewEmail("");
      setNewPassword("");
      setNewName("");
      setNewRole("operator");
      setSelectedPorts([]);
      setSelectedExtensions([]);
      toast.success("User created successfully");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create user";
      toast.error(message);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    // Only admins and super_admins can delete users
    if (role !== "admin" && role !== "super_admin") {
      toast.error("Only administrators can delete users");
      return;
    }

    if (confirm("Are you sure you want to delete this user?")) {
      try {
        const response = await fetch(`${apiUrl}/api/users/${userId}`, {
          method: "DELETE",
          headers: {
            "Authorization": `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          const result = await response.json();
          throw new Error(result.error || "Failed to delete user");
        }

        setUsers(users.filter((u) => u.id !== userId));
        toast.success("User deleted successfully");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to delete user";
        toast.error(message);
      }
    }
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case "admin":
        return "bg-destructive/10 text-destructive";
      case "operator":
        return "bg-primary/10 text-primary";
      default:
        return "bg-secondary/10 text-secondary-foreground";
    }
  };

  return (
    <Card className="card-glow border-border/50 bg-card h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
              <Users className="w-5 h-5 text-primary" />
            </div>
            <CardTitle className="text-base font-semibold">User Management</CardTitle>
          </div>

          <Dialog>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2">
                <Plus className="w-4 h-4" />
                New User
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md max-h-screen overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create New User</DialogTitle>
                <DialogDescription>
                  Add a new user account to the system. New users won't have access to configuration or user management pages.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="create-email">Email</Label>
                  <Input
                    id="create-email"
                    type="email"
                    placeholder="user@example.com"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="create-password">Password</Label>
                  <Input
                    id="create-password"
                    type="password"
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="create-name">Name (optional)</Label>
                  <Input
                    id="create-name"
                    placeholder="John Doe"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="create-role">Role</Label>
                  <Select value={newRole} onValueChange={(value: any) => setNewRole(value)}>
                    <SelectTrigger id="create-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="operator">Operator</SelectItem>
                      <SelectItem value="viewer">Viewer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {newRole === "viewer" && (
                  <>
                    <div className="space-y-2">
                      <Label>Allowed SIM Ports (leave empty for all)</Label>
                      <div className="flex flex-wrap gap-2">
                        {[1, 2, 3, 4].map((port) => (
                          <button
                            key={port}
                            type="button"
                            onClick={() => {
                              setSelectedPorts((prev) =>
                                prev.includes(port) ? prev.filter((p) => p !== port) : [...prev, port]
                              );
                            }}
                            className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                              selectedPorts.includes(port)
                                ? "bg-primary text-primary-foreground border-primary"
                                : "border-border bg-background text-foreground hover:bg-muted"
                            }`}
                          >
                            Port {port}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {selectedPorts.length === 0 ? "No restrictions - can view all ports" : `Restricted to: Port ${selectedPorts.join(", ")}`}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="create-extensions">Allowed Extensions (leave empty for all)</Label>
                      <Input
                        id="create-extensions"
                        placeholder="e.g., 101,102,103 (comma-separated)"
                        value={selectedExtensions.join(",")}
                        onChange={(e) => {
                          const extensions = e.target.value
                            .split(",")
                            .map((ext) => ext.trim())
                            .filter((ext) => ext.length > 0);
                          setSelectedExtensions(extensions);
                        }}
                      />
                      <p className="text-xs text-muted-foreground">
                        {selectedExtensions.length === 0 ? "No restrictions - can view all extensions" : `Restricted to: ${selectedExtensions.join(", ")}`}
                      </p>
                    </div>
                  </>
                )}

                <Button
                  onClick={handleCreateUser}
                  disabled={isCreating || !newEmail || !newPassword}
                  className="w-full"
                >
                  {isCreating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Create User
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {error && (
          <div className="flex items-center gap-2 p-4 rounded-md bg-destructive/10 text-destructive text-sm mx-4 mt-4">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <ScrollArea className="h-[400px]">
          {isLoading ? (
            <div className="flex items-center justify-center h-[300px] text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : users.length === 0 ? (
            <div className="flex items-center justify-center h-[300px] text-muted-foreground">
              <p className="text-sm">No users found</p>
            </div>
          ) : (
            <div className="divide-y divide-border/50 p-4">
              {users.map((u) => (
                <div
                  key={u.id}
                  className="py-3 first:pt-0 last:pb-0 flex items-center justify-between"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-foreground">{u.email}</p>
                    {u.name && (
                      <p className="text-xs text-muted-foreground mt-0.5">{u.name}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <Badge
                        variant="outline"
                        className={`text-xs ${getRoleBadgeColor(u.role)}`}
                      >
                        {u.role}
                      </Badge>
                      {!u.is_active && (
                        <Badge variant="secondary" className="text-xs">
                          Inactive
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 ml-2">
                    {u.id !== currentUser?.id && (role === "admin" || role === "super_admin") && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteUser(u.id)}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

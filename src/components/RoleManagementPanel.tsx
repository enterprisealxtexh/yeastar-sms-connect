import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Shield, ShieldCheck, UserCog, Eye, Crown, UserPlus, Loader2, KeyRound, Trash2 } from "lucide-react";
import { useUsersWithRoles, useCurrentUserRole, useUpdateUserRole, useCreateUser, useDeleteUser, ROLE_META, type AppRole } from "@/hooks/useRoles";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const ROLE_ICONS: Record<AppRole, React.ElementType> = {
  super_admin: Crown,
  admin: ShieldCheck,
  operator: UserCog,
  viewer: Eye,
};

const ROLE_ORDER: AppRole[] = ["super_admin", "admin", "operator", "viewer"];

const generatePin = () => {
  return String(Math.floor(100000 + Math.random() * 900000));
};

export const RoleManagementPanel = () => {
  const { data: users, isLoading } = useUsersWithRoles();
  const { data: currentRole } = useCurrentUserRole();
  const updateRole = useUpdateUserRole();
  const createUser = useCreateUser();

  const isSuperAdmin = currentRole === "super_admin";
  const deleteUser = useDeleteUser();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AppRole>("operator");
  const [pin, setPin] = useState(generatePin());
  const [selectedPorts, setSelectedPorts] = useState<number[]>([]);
  const [selectedExtensions, setSelectedExtensions] = useState<string[]>([]);

  const resetForm = () => {
    setEmail("");
    setFullName("");
    setPassword("");
    setRole("operator");
    setPin(generatePin());
    setSelectedPorts([]);
    setSelectedExtensions([]);
  };

  const handleCreate = async () => {
    if (!email || !password || password.length < 6) return;
    
    const newUserResult = await createUser.mutateAsync({
      email,
      password,
      role,
      full_name: fullName,
      pin,
    });

    // If viewer role and permissions are specified, send them to the API
    if (role === "viewer" && newUserResult && (selectedPorts.length > 0 || selectedExtensions.length > 0)) {
      const token = localStorage.getItem("authToken");
      const apiUrl = import.meta.env.VITE_API_URL;

      try {
        if (selectedPorts.length > 0) {
          await fetch(`${apiUrl}/api/users/${newUserResult.user_id}/port-permissions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`,
            },
            body: JSON.stringify({ ports: selectedPorts }),
          });
        }

        if (selectedExtensions.length > 0) {
          await fetch(`${apiUrl}/api/users/${newUserResult.user_id}/extension-permissions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`,
            },
            body: JSON.stringify({ extensions: selectedExtensions }),
          });
        }
      } catch (error) {
        console.error("Failed to set user permissions:", error);
      }
    }

    setOpen(false);
    resetForm();
  };

  return (
    <div className="space-y-6">
      {/* Role Overview Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {ROLE_ORDER.map((role) => {
          const Icon = ROLE_ICONS[role];
          const count = (users || []).filter((u) => u.role === role).length;
          return (
            <Card key={role}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Icon className="w-4 h-4" />
                  {ROLE_META.labels[role]}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{count}</div>
                <p className="text-xs text-muted-foreground mt-1">{ROLE_META.descriptions[role]}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Shield className="w-4 h-4" />
                User Roles
              </CardTitle>
              <CardDescription>
                {isSuperAdmin
                  ? "As Super Admin, you can assign roles and add users"
                  : "Only Super Admins can modify user roles"}
              </CardDescription>
            </div>
            {isSuperAdmin && (
              <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-2">
                    <UserPlus className="w-4 h-4" />
                    Add User
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-screen overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Create New User</DialogTitle>
                    <DialogDescription>
                      Add a new user with an initial sign-in PIN. They can change it from their profile.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="space-y-2">
                      <Label htmlFor="user-name">Full Name</Label>
                      <Input
                        id="user-name"
                        placeholder="e.g. John Doe"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="user-email">Email Address</Label>
                      <Input
                        id="user-email"
                        type="email"
                        placeholder="user@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="user-password">Password</Label>
                      <Input
                        id="user-password"
                        type="password"
                        placeholder="Min 6 characters"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        minLength={6}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="user-pin">Sign-in PIN</Label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <Input
                            id="user-pin"
                            className="pl-9 font-mono text-lg tracking-widest"
                            value={pin}
                            onChange={(e) => setPin(e.target.value)}
                            maxLength={10}
                            required
                          />
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setPin(generatePin())}
                        >
                          Regenerate
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        This PIN is for kiosk clock-in. The user signs in with email + password above and can change their PIN from their profile.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label>Role</Label>
                      <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLE_ORDER.map((r) => (
                            <SelectItem key={r} value={r}>
                              <span className="flex items-center gap-2">
                                {ROLE_META.labels[r]}
                                <span className="text-xs text-muted-foreground">— {ROLE_META.descriptions[r]}</span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {role === "viewer" && (
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
                          <Label htmlFor="user-extensions">Allowed Extensions (leave empty for all)</Label>
                          <Input
                            id="user-extensions"
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
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                    <Button onClick={handleCreate} disabled={!email || !pin || createUser.isPending}>
                      {createUser.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Create User
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-[200px] rounded-lg" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Current Role</TableHead>
                  <TableHead>Permissions</TableHead>
                  {isSuperAdmin && <TableHead>Change Role</TableHead>}
                  {isSuperAdmin && <TableHead></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(users || []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">No users found</TableCell>
                  </TableRow>
                ) : (
                  (users || []).map((user) => {
                    const Icon = ROLE_ICONS[user.role];
                    const isCurrentSuperAdmin = user.role === "super_admin";
                    return (
                      <TableRow key={user.user_id}>
                        <TableCell>
                          <div className="font-medium">{user.email}</div>
                          <div className="text-xs text-muted-foreground">ID: {user.user_id.slice(0, 8)}...</div>
                        </TableCell>
                        <TableCell>
                          <Badge className={cn("gap-1", ROLE_META.colors[user.role])}>
                            <Icon className="w-3 h-3" />
                            {ROLE_META.labels[user.role]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="text-xs text-muted-foreground max-w-[200px]">
                            {ROLE_META.descriptions[user.role]}
                          </div>
                        </TableCell>
                        {isSuperAdmin && (
                          <TableCell>
                            {isCurrentSuperAdmin ? (
                              <span className="text-xs text-muted-foreground">Protected</span>
                            ) : (
                              <Select
                                value={user.role}
                                onValueChange={(value) =>
                                  updateRole.mutate({ userId: user.user_id, role: value as AppRole })
                                }
                              >
                                <SelectTrigger className="w-[140px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {ROLE_ORDER.filter((r) => r !== "super_admin").map((role) => (
                                    <SelectItem key={role} value={role}>
                                      {ROLE_META.labels[role]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </TableCell>
                        )}
                        {isSuperAdmin && (
                          <TableCell>
                            {!isCurrentSuperAdmin && (
                              confirmDeleteId === user.user_id ? (
                                <div className="flex items-center gap-1">
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    disabled={deleteUser.isPending}
                                    onClick={() => {
                                      deleteUser.mutate(user.user_id, { onSettled: () => setConfirmDeleteId(null) });
                                    }}
                                  >
                                    {deleteUser.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Confirm"}
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
                                </div>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                  onClick={() => setConfirmDeleteId(user.user_id)}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              )
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Role Hierarchy */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Role Hierarchy</CardTitle>
          <CardDescription>Permissions cascade downward — higher roles include all lower permissions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {ROLE_ORDER.map((role, i) => {
              const Icon = ROLE_ICONS[role];
              return (
                <div key={role} className="flex items-start gap-3">
                  <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0", ROLE_META.colors[role])}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-medium text-sm">{ROLE_META.labels[role]}</div>
                    <div className="text-xs text-muted-foreground">{ROLE_META.descriptions[role]}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

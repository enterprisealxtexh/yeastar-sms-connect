import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { User, Mail, Lock, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useUserProfile } from "@/hooks/useUserProfile";
import { formatDateNairobi } from "@/lib/dateUtils";

export const UserProfilePanel = () => {
  const { profile, isLoading, isUpdating, updateProfile } = useUserProfile();
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Initialize form fields when profile loads
  useEffect(() => {
    if (profile) {
      setEditName(profile.name || "");
      setEditEmail(profile.email || "");
    }
  }, [profile]);

  const handleUpdateProfile = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const data: any = {};
    
    if (editEmail !== profile?.email) {
      data.email = editEmail;
    }
    
    if (editName !== profile?.name) {
      data.name = editName;
    }

    if (newPassword) {
      if (!oldPassword) {
        setError("Old password is required to set a new password");
        return;
      }
      if (newPassword !== confirmPassword) {
        setError("New passwords do not match");
        return;
      }
      if (newPassword.length < 6) {
        setError("New password must be at least 6 characters");
        return;
      }
      data.password = newPassword;
      data.oldPassword = oldPassword;
    }

    if (Object.keys(data).length === 0) {
      toast.info("No changes to save");
      return;
    }

    updateProfile(data);
    
    // Clear password fields after submission
    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };

  if (isLoading) {
    return (
      <Card className="card-glow border-border/50 bg-card h-full">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
              <User className="w-5 h-5 text-primary" />
            </div>
            <CardTitle className="text-base font-semibold">Profile Settings</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[300px]">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!profile) {
    return (
      <Card className="card-glow border-border/50 bg-card h-full">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
              <User className="w-5 h-5 text-primary" />
            </div>
            <CardTitle className="text-base font-semibold">Profile Settings</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[300px] text-muted-foreground">
          <p className="text-sm">Unable to load profile</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="card-glow border-border/50 bg-card h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
              <User className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold">Profile Settings</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">Manage your account information</p>
            </div>
          </div>
          <Badge
            variant="outline"
            className="text-xs font-mono"
          >
            {profile.role}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <ScrollArea className="h-[600px] p-4">
          <form onSubmit={handleUpdateProfile} className="space-y-6 max-w-lg">
            {/* User Info Section */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground">Account Information</h3>
              
              <div className="space-y-2">
                <Label htmlFor="email" className="text-xs font-medium">Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="name" className="text-xs font-medium">Display Name</Label>
                <Input
                  id="name"
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Your name"
                />
              </div>

              <div className="space-y-2 text-xs text-muted-foreground">
                <p>User ID: <span className="font-mono">{profile.id}</span></p>
                <p>Role: <span className="font-mono capitalize">{profile.role}</span></p>
                <p>Member Since: <span className="font-mono">{formatDateNairobi(profile.created_at)}</span></p>
              </div>
            </div>

            {/* Password Section */}
            <div className="space-y-4 pt-4 border-t border-border/50">
              <h3 className="text-sm font-semibold text-foreground">Change Password</h3>
              
              <div className="space-y-2">
                <Label htmlFor="oldPassword" className="text-xs font-medium">Current Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="oldPassword"
                    type="password"
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    placeholder="Enter current password"
                    className="pl-10"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="newPassword" className="text-xs font-medium">New Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="newPassword"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password (min 6 characters)"
                    className="pl-10"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-xs font-medium">Confirm New Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    className="pl-10"
                  />
                </div>
              </div>

              {newPassword && newPassword.length > 0 && (
                <div className="text-xs text-muted-foreground bg-muted/30 p-2 rounded">
                  Password strength: {newPassword.length >= 8 ? "Strong" : newPassword.length >= 6 ? "Medium" : "Weak"}
                </div>
              )}
            </div>

            {/* Error Message */}
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Submit Button */}
            <div className="flex items-center gap-2 pt-4 border-t border-border/50">
              <Button
                type="submit"
                disabled={isUpdating}
                className="w-full"
              >
                {isUpdating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
            </div>

            <div className="text-xs text-muted-foreground bg-muted/20 p-3 rounded">
              <p className="font-medium mb-1">📝 Note:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Leave password fields empty if you don't want to change your password</li>
                <li>Your current password is required to set a new password</li>
                <li>Changes are saved immediately</li>
              </ul>
            </div>
          </form>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

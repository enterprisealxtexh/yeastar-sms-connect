import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { User, Mail, Lock, Loader2, AlertCircle, Calendar, Shield, Activity, LogOut } from "lucide-react";
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
  const [passwordStrength, setPasswordStrength] = useState<"weak" | "medium" | "strong" | null>(null);

  // Initialize form fields when profile loads
  useEffect(() => {
    if (profile) {
      setEditName(profile.name || "");
      setEditEmail(profile.email || "");
    }
  }, [profile]);

  // Calculate password strength
  useEffect(() => {
    if (newPassword.length === 0) {
      setPasswordStrength(null);
    } else if (newPassword.length < 6) {
      setPasswordStrength("weak");
    } else if (newPassword.length < 10) {
      setPasswordStrength("medium");
    } else {
      setPasswordStrength("strong");
    }
  }, [newPassword]);

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

  const getRoleColor = (role: string) => {
    switch (role?.toLowerCase()) {
      case "admin":
        return "bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800";
      case "operator":
        return "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800";
      case "viewer":
        return "bg-green-500/10 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getStrengthColor = (strength: string | null) => {
    switch (strength) {
      case "strong":
        return "bg-green-500/20 text-green-700 dark:text-green-400";
      case "medium":
        return "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400";
      case "weak":
        return "bg-red-500/20 text-red-700 dark:text-red-400";
      default:
        return "";
    }
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">Loading profile...</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <Card className="border-destructive/50 bg-destructive/5">
        <CardContent className="pt-6 text-center">
          <AlertCircle className="w-8 h-8 mx-auto mb-2 text-destructive" />
          <p className="text-sm text-muted-foreground">Unable to load profile</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4 h-full overflow-auto pb-6">
      {/* Profile Header Card */}
      <Card className="border-border/50 bg-gradient-to-br from-primary/5 via-primary/2 to-transparent overflow-hidden">
        <CardContent className="p-6">
          <div className="flex items-start justify-between gap-6">
            <div className="flex items-end gap-4">
              {/* Avatar */}
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary to-primary/50 flex items-center justify-center border-4 border-background shadow-lg">
                <User className="w-10 h-10 text-primary-foreground" />
              </div>
              
              {/* User Basic Info */}
              <div className="pb-1 space-y-2">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">{profile.name}</h2>
                  <p className="text-sm text-muted-foreground">{profile.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={`${getRoleColor(profile.role)} border`}>
                    {profile.role.charAt(0).toUpperCase() + profile.role.slice(1)}
                  </Badge>
                </div>
              </div>
            </div>
            
            {/* Quick Stats */}
            <div className="text-right space-y-2">
              <div className="text-xs text-muted-foreground">
                <Calendar className="w-4 h-4 inline mr-1" />
                Member since {formatDateNairobi(profile.created_at).split(" ")[0]}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Tabs Section */}
      <Card className="border-border/50 bg-card flex flex-col flex-1">
        <Tabs defaultValue="account" className="w-full flex flex-col h-full">
          {/* Tab Navigation */}
          <CardHeader className="border-b border-border/50 pb-3">
            <TabsList className="grid w-full grid-cols-3 bg-muted/50">
              <TabsTrigger value="account" className="gap-2">
                <User className="w-4 h-4" />
                <span className="hidden sm:inline">Account</span>
              </TabsTrigger>
              <TabsTrigger value="security" className="gap-2">
                <Shield className="w-4 h-4" />
                <span className="hidden sm:inline">Security</span>
              </TabsTrigger>
              <TabsTrigger value="activity" className="gap-2">
                <Activity className="w-4 h-4" />
                <span className="hidden sm:inline">Activity</span>
              </TabsTrigger>
            </TabsList>
          </CardHeader>

          {/* Tab Contents */}
          <ScrollArea className="flex-1">
            {/* Account Tab */}
            <TabsContent value="account" className="p-6 space-y-6">
              <form onSubmit={handleUpdateProfile} className="space-y-6">
                {/* Basic Information Section */}
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-4">Basic Information</h3>
                  </div>
                  
                  {/* Display Name */}
                  <div className="space-y-2">
                    <Label htmlFor="name" className="text-sm font-medium">Display Name</Label>
                    <Input
                      id="name"
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Your name"
                      className="h-10"
                    />
                    <p className="text-xs text-muted-foreground">This is how your name appears in the system</p>
                  </div>

                  {/* Email Address */}
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-sm font-medium">Email Address</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="email"
                        type="email"
                        value={editEmail}
                        onChange={(e) => setEditEmail(e.target.value)}
                        className="pl-10 h-10"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">Your email cannot be used to login yet, contact admin to enable</p>
                  </div>
                </div>

                {/* Account Details Section */}
                <div className="space-y-3 p-4 rounded-lg bg-muted/30 border border-border/50">
                  <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide">Account Details</h4>
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <p className="text-muted-foreground">User ID</p>
                      <p className="font-mono text-foreground mt-1">{profile.id}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Role</p>
                      <p className="capitalize text-foreground mt-1 font-medium">{profile.role}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Member Since</p>
                      <p className="font-mono text-foreground mt-1">{formatDateNairobi(profile.created_at)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Status</p>
                      <div className="mt-1 flex items-center gap-1">
                        <span className="inline-block w-2 h-2 rounded-full bg-green-500"></span>
                        <span className="text-foreground">Active</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Error Message */}
                {error && (
                  <div className="flex items-start gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                    <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                    <span className="text-sm text-destructive">{error}</span>
                  </div>
                )}

                {/* Save Button */}
                <div className="flex gap-2 pt-2">
                  <Button
                    type="submit"
                    disabled={isUpdating}
                    className="flex-1"
                  >
                    {isUpdating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Save Changes
                  </Button>
                </div>
              </form>
            </TabsContent>

            {/* Security Tab */}
            <TabsContent value="security" className="p-6">
              <form onSubmit={handleUpdateProfile} className="space-y-6">
                {/* Change Password Section */}
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-1">Change Password</h3>
                    <p className="text-xs text-muted-foreground">Keep your account secure by using a strong password</p>
                  </div>

                  {/* Current Password */}
                  <div className="space-y-2 pt-2">
                    <Label htmlFor="oldPassword" className="text-sm font-medium">Current Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="oldPassword"
                        type="password"
                        value={oldPassword}
                        onChange={(e) => setOldPassword(e.target.value)}
                        placeholder="Enter your current password"
                        className="pl-10 h-10"
                      />
                    </div>
                  </div>

                  {/* New Password */}
                  <div className="space-y-2">
                    <Label htmlFor="newPassword" className="text-sm font-medium">New Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="newPassword"
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Enter new password"
                        className="pl-10 h-10"
                      />
                    </div>
                    
                    {/* Password Strength Indicator */}
                    {newPassword && (
                      <div className="flex items-center gap-2 pt-2">
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all ${
                              passwordStrength === "strong"
                                ? "w-full bg-green-500"
                                : passwordStrength === "medium"
                                ? "w-2/3 bg-yellow-500"
                                : "w-1/3 bg-red-500"
                            }`}
                          />
                        </div>
                        <span className={`text-xs font-medium ${getStrengthColor(passwordStrength)}`}>
                          {passwordStrength?.charAt(0).toUpperCase() + passwordStrength?.slice(1)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Confirm Password */}
                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword" className="text-sm font-medium">Confirm Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="confirmPassword"
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Confirm your new password"
                        className="pl-10 h-10"
                      />
                    </div>
                  </div>
                </div>

                {/* Security Tips */}
                <div className="space-y-3 p-4 rounded-lg bg-blue-500/10 border border-blue-200 dark:border-blue-800">
                  <h4 className="text-xs font-semibold text-blue-900 dark:text-blue-100 uppercase tracking-wide">🔐 Password Tips</h4>
                  <ul className="text-xs text-blue-800 dark:text-blue-200 space-y-1 list-disc list-inside">
                    <li>Use at least 8 characters for better security</li>
                    <li>Mix uppercase, lowercase, numbers, and symbols</li>
                    <li>Avoid using personal information</li>
                    <li>Don't reuse passwords from other accounts</li>
                  </ul>
                </div>

                {/* Error Message */}
                {error && (
                  <div className="flex items-start gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/20">
                    <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                    <span className="text-sm text-destructive">{error}</span>
                  </div>
                )}

                {/* Save Button */}
                <div className="flex gap-2 pt-2">
                  <Button
                    type="submit"
                    disabled={isUpdating || !newPassword}
                    className="flex-1"
                  >
                    {isUpdating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Update Password
                  </Button>
                </div>
              </form>
            </TabsContent>

            {/* Activity Tab */}
            <TabsContent value="activity" className="p-6 space-y-6">
              <div>
                <h3 className="text-sm font-semibold text-foreground mb-4">Login Activity</h3>
              </div>

              {/* Activity Info Cards */}
              <div className="grid gap-4 md:grid-cols-2">
                <Card className="border-border/50">
                  <CardContent className="pt-6">
                    <div className="flex items-start gap-3">
                      <div className="flex-1">
                        <p className="text-xs text-muted-foreground mb-1">Last Login</p>
                        <p className="text-sm font-semibold">Recent (Check logs for details)</p>
                      </div>
                      <LogOut className="w-5 h-5 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border/50">
                  <CardContent className="pt-6">
                    <div className="flex items-start gap-3">
                      <div className="flex-1">
                        <p className="text-xs text-muted-foreground mb-1">Active Sessions</p>
                        <p className="text-sm font-semibold">1 Session</p>
                      </div>
                      <Shield className="w-5 h-5 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Activity Legend */}
              <div className="space-y-3 p-4 rounded-lg bg-muted/30 border border-border/50">
                <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide">📊 How to Monitor Activity</h4>
                <ul className="text-xs text-muted-foreground space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="text-primary mt-1">•</span>
                    <span>Login details including IP address and timestamps are logged to the Activity Log</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary mt-1">•</span>
                    <span>Ask your administrator to review the Activity Log for detailed login history</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary mt-1">•</span>
                    <span>Contact support if you see unfamiliar login activity</span>
                  </li>
                </ul>
              </div>
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </Card>
    </div>
  );
};

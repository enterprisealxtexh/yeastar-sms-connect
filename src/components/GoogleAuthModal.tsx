import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface GoogleAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: (token: string) => void;
  isLoading?: boolean;
}

export const GoogleAuthModal = ({
  isOpen,
  onClose,
  onAuthSuccess,
  isLoading = false,
}: GoogleAuthModalProps) => {
  const [step, setStep] = useState<"choice" | "manual">("choice");
  const [token, setToken] = useState("");

  const handleOpenGoogleAuth = () => {
    // Create OAuth 2.0 authorization URL for Google Contacts API
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
    const redirectUri = `${window.location.origin}/auth/google`;
    const scope = encodeURIComponent(
      "https://www.googleapis.com/auth/contacts.readonly"
    );
    const responseType = "code";
    const accessType = "offline";
    const prompt = "consent";

    if (!clientId) {
      console.error("Google Client ID not configured in .env");
      alert(
        "Google OAuth not configured. Please set VITE_GOOGLE_CLIENT_ID in .env"
      );
      return;
    }

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&response_type=${responseType}&scope=${scope}&access_type=${accessType}&prompt=${prompt}`;

    // Open OAuth flow in a popup or new tab
    window.open(authUrl, "google_auth", "width=500,height=600");
  };

  const handleTokenSubmit = () => {
    if (!token.trim()) {
      alert("Please enter a valid token");
      return;
    }
    onAuthSuccess(token);
    setToken("");
    setStep("choice");
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect Google Contacts</DialogTitle>
          <DialogDescription>
            Authenticate with Google to import and sync contacts
          </DialogDescription>
        </DialogHeader>

        {step === "choice" && (
          <div className="space-y-4">
            <Alert className="bg-blue-50 border-blue-200">
              <AlertCircle className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-800">
                Choose how you want to authenticate with Google Contacts.
              </AlertDescription>
            </Alert>

            <div className="space-y-3">
              <Button
                onClick={handleOpenGoogleAuth}
                disabled={isLoading}
                className="w-full gap-2"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                )}
                Continue with Google
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">
                    Or
                  </span>
                </div>
              </div>

              <Button
                variant="outline"
                onClick={() => setStep("manual")}
                className="w-full"
              >
                Enter Token Manually
              </Button>
            </div>

            <p className="text-xs text-muted-foreground text-center">
              A popup will open for Google authentication. Make sure popups are
              enabled in your browser.
            </p>
          </div>
        )}

        {step === "manual" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="token">Google Access Token</Label>
              <Input
                id="token"
                type="password"
                placeholder="Paste your Google access token here"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                You can get an access token from Google Cloud Console or by
                authenticating with Google.
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setStep("choice");
                  setToken("");
                }}
                className="flex-1"
              >
                Back
              </Button>
              <Button
                onClick={handleTokenSubmit}
                disabled={!token.trim() || isLoading}
                className="flex-1"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Connect"
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

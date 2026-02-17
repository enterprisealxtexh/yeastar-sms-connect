import { useEffect, useRef } from "react";
import { useAuth } from "./useAuth";
import { signOut } from "./useAuth";
import { toast } from "sonner";

const INACTIVITY_TIMEOUT = 20 * 60 * 1000; // 20 minutes in milliseconds
const WARNING_TIME = 19 * 60 * 1000; // 19 minutes - show warning 1 minute before logout

export const useInactivityLogout = () => {
  const { isAuthenticated } = useAuth();
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const warningTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  const resetInactivityTimer = () => {
    if (!isAuthenticated) return;

    // Clear existing timeouts
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);

    lastActivityRef.current = Date.now();

    // Set warning timeout (1 minute before logout)
    warningTimeoutRef.current = setTimeout(() => {
      toast.warning("You will be logged out in 1 minute due to inactivity", {
        duration: 10000,
      });
    }, WARNING_TIME);

    // Set logout timeout
    timeoutRef.current = setTimeout(async () => {
      toast.error("Session expired due to inactivity. Please log in again.");
      await signOut();
    }, INACTIVITY_TIMEOUT);
  };

  useEffect(() => {
    if (!isAuthenticated) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);
      return;
    }

    // Initialize the timer on mount
    resetInactivityTimer();

    // Track user activity
    const events = ["mousedown", "keydown", "scroll", "touchstart", "click"];

    const handleActivity = () => {
      resetInactivityTimer();
    };

    events.forEach((event) => {
      document.addEventListener(event, handleActivity);
    });

    // Cleanup
    return () => {
      events.forEach((event) => {
        document.removeEventListener(event, handleActivity);
      });
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (warningTimeoutRef.current) clearTimeout(warningTimeoutRef.current);
    };
  }, [isAuthenticated]);
};

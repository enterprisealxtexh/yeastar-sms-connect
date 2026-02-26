import { useState, useEffect } from "react";

export type AppRole = "admin" | "operator" | "viewer";

interface AuthState {
  user: any | null;
  session: any | null;
  role: AppRole | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isOperator: boolean;
}

interface LoginCredentials {
  email: string;
  password: string;
}

const apiUrl = import.meta.env.VITE_API_URL;

export const useAuth = (): AuthState => {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<any | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    // Check localStorage for existing session on mount
    const storedUser = localStorage.getItem('user');
    const storedToken = localStorage.getItem('authToken');
    
    if (storedUser && storedToken) {
      try {
        const parsedUser = JSON.parse(storedUser);
        setUser(parsedUser);
        setIsAuthenticated(true);
      } catch (error) {
        console.error('Failed to parse stored user:', error);
        localStorage.removeItem('user');
        localStorage.removeItem('authToken');
      }
    }
    
    setIsLoading(false);
  }, []);

  const role = user?.role || null;
  const isAdmin = role === 'admin';
  const isOperator = role === 'operator' || isAdmin;

  return {
    user,
    session: isAuthenticated ? { user } : null,
    role: role as AppRole | null,
    isLoading,
    isAuthenticated,
    isAdmin,
    isOperator,
  };
};

export const login = async (credentials: LoginCredentials) => {
  try {
    const response = await fetch(`${apiUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });

    const result = await response.json();
    
    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Login failed');
    }

    // Store user and token in localStorage
    localStorage.setItem('user', JSON.stringify(result.user));
    localStorage.setItem('authToken', result.token);
    
    // Log login activity
    try {
      await fetch(`${apiUrl}/api/activity-logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: 'user_login',
          message: `User ${credentials.email} logged in`,
          severity: 'success',
          username: credentials.email
        }),
      });
    } catch (e) {
      console.error('Failed to log login activity:', e);
    }
    
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login failed';
    throw new Error(message);
  }
};

export const register = async (email: string, password: string, name?: string) => {
  try {
    const response = await fetch(`${apiUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    });

    const result = await response.json();
    
    if (!response.ok || !result.success) {
      throw new Error(result.error || 'Registration failed');
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Registration failed';
    throw new Error(message);
  }
};

export const signOut = async () => {
  try {
    // Call logout endpoint
    await fetch(`${apiUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Logout error:', error);
  } finally {
    // Always clear local storage
    localStorage.removeItem('user');
    localStorage.removeItem('authToken');
    // Reload to reset auth state
    window.location.href = '/auth';
  }
};

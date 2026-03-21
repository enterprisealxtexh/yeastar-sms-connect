import { useState, useEffect } from "react";
import { authApi } from "@/lib/api-client";

export type AppRole = "super_admin" | "admin" | "operator" | "viewer";

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
  const isAdmin = role === 'admin' || role === 'super_admin';
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
    const result = await authApi.login(credentials.email, credentials.password);
    
    if (!result.success) {
      throw new Error(result.error || 'Login failed');
    }

    // Store user and token in localStorage
    // Backend returns { success: true, token: "...", user: {...} } directly
    const userData = result.user;
    const token = result.token;
    
    if (userData && token) {
      localStorage.setItem('user', JSON.stringify(userData));
      localStorage.setItem('authToken', token);
      
      // Log login activity
      try {
        authApi.logActivity({
          event_type: 'user_login',
          message: `User ${credentials.email} logged in`,
          severity: 'success',
          username: credentials.email
        });
      } catch (e) {
        console.error('Failed to log login activity:', e);
      }
    }
    
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login failed';
    throw new Error(message);
  }
};

export const register = async (email: string, password: string, name?: string) => {
  try {
    const result = await authApi.register(email, password, name);
    
    if (!result.success) {
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
    await authApi.logout();
  } catch (error) {
    console.error('Logout error:', error);
  } finally {
    localStorage.removeItem('user');
    localStorage.removeItem('authToken');
    window.location.href = '/auth';
  }
};

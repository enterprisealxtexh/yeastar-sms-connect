/**
 * API Client for Local SQLite Backend
 * Replaces Supabase with a local API that uses SQLite
 */

const API_URL = import.meta.env.VITE_API_URL;

interface Database {
  sms_messages: any[];
  sim_port_config: any[];
  gateway_config: any[];
  activity_logs: any[];
  agent_heartbeat: any[];
  [key: string]: any[];
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
}

class ApiClient {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;

  constructor(baseUrl: string = API_URL) {
    this.baseUrl = baseUrl;
    this.defaultHeaders = {
      'Content-Type': 'application/json',
    };
  }

  private async request<T>(
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = { ...this.defaultHeaders, ...options.headers };

    const config: RequestInit = {
      method: options.method || 'GET',
      headers,
    };

    if (options.body) {
      config.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, config);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `API Error: ${response.statusText}`);
    }

    return response.json();
  }

  // Health check
  async health() {
    return this.request('/api/health');
  }

  // Gateway config
  async getGatewayConfig() {
    const result = await this.request<{ data: any }>('/api/gateway-config');
    return { data: result.data || null, error: null };
  }

  async saveGatewayConfig(config: Record<string, unknown>) {
    try {
      const result = await this.request<{ data: any }>('/api/gateway-config', {
        method: 'POST',
        body: config,
      });
      return { data: [result.data], error: null };
    } catch (error) {
      return { data: null, error };
    }
  }

  // SMS messages
  async getSmsMessages(options: {
    limit?: number;
    sim_port?: number;
    status?: string;
    since?: string;
  } = {}) {
    const params = new URLSearchParams();
    if (options.limit) params.append('limit', options.limit.toString());
    if (options.sim_port) params.append('sim_port', options.sim_port.toString());
    if (options.status) params.append('status', options.status);
    if (options.since) params.append('since', options.since);

    const result = await this.request<{ data: any[] }>(
      `/api/sms-messages?${params}`
    );
    return { data: result.data || [], error: null };
  }

  async saveSmsMessage(data: any) {
    try {
      const result = await this.request<{ data: any }>('/api/sms-messages', {
        method: 'POST',
        body: data,
      });
      return { data: result.data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }

  async saveBulkSmsMessages(messages: any[]) {
    try {
      const result = await this.request<{ data: any }>('/api/sms-messages/bulk', {
        method: 'POST',
        body: { messages },
      });
      return { data: result.data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }

  async updateSmsStatus(id: string, status: string) {
    try {
      await this.request(`/api/sms-messages/${id}/status`, {
        method: 'PUT',
        body: { status },
      });
      return { error: null };
    } catch (error) {
      return { error };
    }
  }
  // Call Records
  async getCallRecords() {
    try {
      const result = await this.request<{ data: any[] }>('/api/call-records');
      return { data: result.data || [], error: null };
    } catch (error) {
      return { data: [], error };
    }
  }

  async getCallStats() {
    try {
      const result = await this.request<{ data: any }>('/api/call-stats');
      return { data: result.data || null, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }
  // Port status
  async getPortStatus(portNumber?: number) {
    const params = portNumber ? `?port_number=${portNumber}` : '';
    const result = await this.request<{ data: any | any[] }>(
      `/api/port-status${params}`
    );
    return { data: result.data || (portNumber ? null : []), error: null };
  }

  async updatePortStatus(portNumber: number, status: Record<string, unknown>) {
    try {
      const result = await this.request<{ data: any }>(`/api/port-status/${portNumber}`, {
        method: 'PUT',
        body: status,
      });
      return { data: result.data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }

  // Activity logs
  async getActivityLogs(options: { limit?: number; severity?: string } = {}) {
    const params = new URLSearchParams();
    if (options.limit) params.append('limit', options.limit.toString());
    if (options.severity) params.append('severity', options.severity);

    const result = await this.request<{ data: any[] }>(
      `/api/activity-logs?${params}`
    );
    return { data: result.data || [], error: null };
  }

  // Statistics
  async getStatistics() {
    const result = await this.request<{ data: any }>('/api/statistics');
    return { data: result.data, error: null };
  }

  // Agent heartbeat
  async updateHeartbeat(agentId: string, data: Record<string, unknown>) {
    try {
      await this.request('/api/agent-heartbeat', {
        method: 'POST',
        body: { agent_id: agentId, ...data },
      });
      return { error: null };
    } catch (error) {
      return { error };
    }
  }

  async getHeartbeat(agentId?: string) {
    const params = agentId ? `?agent_id=${agentId}` : '';
    const result = await this.request<{ data: any | any[] }>(
      `/api/agent-heartbeat${params}`
    );
    return { data: result.data || (agentId ? null : []), error: null };
  }

  // Realtime subscription (simulated)
  on(event: string, callback: (data: any) => void) {
    console.warn(`Realtime subscriptions not yet implemented for ${event}`);
    return {
      unsubscribe: () => {},
    };
  }

  subscribe() {
    return this;
  }

  // Auth stub (no auth with SQLite)
  auth = {
    getSession: async () => ({ data: { session: null } }),
    setSession: async () => {},
    onAuthStateChange: () => ({
      data: { subscription: { unsubscribe: () => {} } },
    }),
  };

  // Functions stub (no edge functions with SQLite)
  functions = {
    invoke: async (functionName: string, options?: any) => {
      console.warn(`Edge functions not available: ${functionName}`);
      return { data: null, error: new Error('Edge functions not available') };
    },
  };

  // RPC stub (no RPC with SQLite)
  rpc = async (functionName: string, options?: any) => {
    console.warn(`RPC functions not available: ${functionName}`);
    return { data: null, error: new Error('RPC functions not available') };
  };

  // Table operations - route to local API endpoints
  from(tableName: string) {
    const self = this;
    return {
      select: () => ({
        eq: () => ({ single: async () => ({ data: null, error: null }) }),
        limit: () => ({ single: async () => ({ data: null, error: null }) }),
        range: async () => ({ data: [], error: null }),
        async: async () => ({ data: [], error: null }),
      }),
      insert: async (data: any) => {
        try {
          // Route table inserts to appropriate endpoints
          if (tableName === 'sms_messages') {
            const result = await self.request<{ data: any }>('/api/sms-messages', {
              method: 'POST',
              body: data,
            });
            return { data: [result.data || data], error: null };
          } else if (tableName === 'activity_logs') {
            const result = await self.request<{ data: any }>('/api/activity-logs', {
              method: 'POST',
              body: data,
            });
            return { data: [result.data || data], error: null };
          }
          return { data: [data], error: null };
        } catch (error) {
          return { data: null, error };
        }
      },
      update: async (data: any) => {
        try {
          if (tableName === 'sms_messages') {
            const result = await self.request<{ data: any }>('/api/sms-messages', {
              method: 'PUT',
              body: data,
            });
            return { data: [result.data || data], error: null };
          }
          return { data: [data], error: null };
        } catch (error) {
          return { data: null, error };
        }
      },
      delete: async () => ({ error: null }),
    };
  }

  removeChannel() {
    return this;
  }
}

// Create and export singleton instance
export const apiClient = new ApiClient();

// Export for use like supabase
export const supabase = apiClient;

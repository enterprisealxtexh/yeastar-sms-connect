/**
 * Centralized API Client
 *
 * ALL API calls must go through this module — no direct fetch() calls in hooks/components.
 *
 * VITE_API_URL = domain only, no /api suffix:
 *   - Dev:  http://localhost:2003
 *   - Prod: https://calls.nosteq.co.ke  (Nginx proxies /api → localhost:2003)
 */

const BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:2003').replace(/\/+$/, '');

/**
 * Core fetch wrapper.
 * - Prepends /api if missing
 * - Attaches Bearer token from localStorage
 * - Returns { success, data?, error? }
 */
export async function apiCall<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<{ success: boolean; data?: T; error?: string }> {
  try {
    const path = endpoint.startsWith('/api/') ? endpoint : `/api/${endpoint.replace(/^\//, '')}`;
    const token = localStorage.getItem('authToken');

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const response = await fetch(`${BASE_URL}${path}`, { ...options, headers });
    const result = await response.json();

    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);

    return { success: true, data: result.data ?? result };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error };
  }
}

/**
 * Throws on error – use inside React Query queryFn.
 * Returns result.data only — use apiFetchFull when you need pagination or other top-level fields.
 */
export async function apiFetch<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const result = await apiCall<T>(endpoint, options);
  if (!result.success) throw new Error(result.error || 'API error');
  return result.data as T;
}

/**
 * Like apiFetch but returns the full API response body (including pagination, etc).
 * Use for paginated endpoints that return { success, data, pagination }.
 */
export async function apiFetchFull<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const path = endpoint.startsWith('/api/') ? endpoint : `/api/${endpoint.replace(/^\//, '')}`;
  const token = localStorage.getItem('authToken');
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const response = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || `HTTP ${response.status}`);
  return result as T;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    apiCall('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  register: (email: string, password: string, name?: string) =>
    apiCall('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password, name }) }),

  logout: () =>
    apiCall('/api/auth/logout', { method: 'POST' }),

  logActivity: (activity: any) =>
    apiCall('/api/activity-logs', { method: 'POST', body: JSON.stringify(activity) }),
};

// ─── SMS ──────────────────────────────────────────────────────────────────────
export const smsApi = {
  messages: (params?: { limit?: number; direction?: string; since?: string; sim_port?: number }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.direction) q.set('direction', params.direction);
    if (params?.since) q.set('since', params.since);
    if (params?.sim_port != null) q.set('sim_port', String(params.sim_port));
    return apiFetch<any[]>(`/api/sms-messages?${q}`);
  },
  updateStatus: (id: string, status: string) =>
    apiCall(`/api/sms-messages/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
  markAllRead: () =>
    apiCall('/api/sms-messages/mark-all-read', { method: 'PUT' }),
  send: (phoneNumber: string, message: string) =>
    apiCall('/api/sms-send', { method: 'POST', body: JSON.stringify({ phoneNumber, message }) }),
  getReportRecipients: () => apiFetch('/api/sms-report-recipients'),
  templates: () => apiFetch<any[]>('/api/sms-templates'),
  createTemplate: (data: { name: string; message: string }) =>
    apiCall('/api/sms-templates', { method: 'POST', body: JSON.stringify(data) }),
  updateTemplate: (id: string, data: { name: string; message: string; active: boolean }) =>
    apiCall(`/api/sms-templates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTemplate: (id: string) =>
    apiCall(`/api/sms-templates/${id}`, { method: 'DELETE' }),
};

// ─── Calls ────────────────────────────────────────────────────────────────────
export const callsApi = {
  records: (params?: { page?: number; pageSize?: number; extension?: string; direction?: string; status?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.page) q.set('page', String(params.page));
    if (params?.pageSize) q.set('pageSize', String(params.pageSize));
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.extension && params.extension !== 'all') q.set('extension', params.extension);
    if (params?.direction && params.direction !== 'all') q.set('direction', params.direction);
    if (params?.status && params.status !== 'all') q.set('status', params.status);
    return apiFetchFull<{ success: boolean; data: any[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }>(`/api/call-records?${q}`);
  },
  stats: (extension?: string) => {
    const q = extension && extension !== 'all' ? `?extension=${encodeURIComponent(extension)}` : '';
    return apiFetch<any>(`/api/call-stats${q}`);
  },
  allTimeStats: (extension?: string) => {
    const q = extension && extension !== 'all' ? `?extension=${encodeURIComponent(extension)}` : '';
    return apiFetch<any>(`/api/call-stats/all-time${q}`);
  },
  statistics: () => apiFetch<any>('/api/statistics'),
  markCallback: (id: string, notes?: string) =>
    apiCall(`/api/call-records/${id}/callback`, {
      method: 'PUT',
      body: JSON.stringify({ callback_attempted: true, callback_notes: notes || null }),
    }),
  sendMissedCallNotify: (callerNumber: string) =>
    apiCall('/api/missed-call-notify', { method: 'POST', body: JSON.stringify({ caller_number: callerNumber }) }),
  pbxLogs: () =>
    apiCall('/api/pbx-call/logs', { method: 'POST', body: JSON.stringify({}) }),
};

// ─── Gateway / PBX ───────────────────────────────────────────────────────────
export const gatewayApi = {
  config: () => apiFetch<any>('/api/gateway-config'),
  saveConfig: (data: { gateway_ip?: string; api_username?: string; api_password?: string }) =>
    apiCall('/api/gateway-config', { method: 'POST', body: JSON.stringify(data) }),
  status: () => apiFetch<any>('/api/gateway-status'),
  pbxConfig: () => apiFetch<any>('/api/pbx-config'),
  savePbxConfig: (data: any) =>
    apiCall('/api/pbx-config', { method: 'POST', body: JSON.stringify(data) }),
  pbxStatus: () => apiFetch<any>('/api/pbx-status'),
  health: () => apiFetch('/api/health'),
  gsmSpans: () => apiFetch<any[]>('/api/gsm-spans'),
  updateGsmSpan: (gsmSpan: number, data: { name?: string | null; phone_number?: string | null }) =>
    apiCall(`/api/gsm-spans/${gsmSpan}`, { method: 'PUT', body: JSON.stringify(data) }),
  checkGsmSpans: () => apiCall('/api/check-gsm-spans', { method: 'POST' }),
  extensions: () => apiFetch<any>('/api/extensions'),
};

// ─── Agents ───────────────────────────────────────────────────────────────────
export const agentsApi = {
  list: () => apiFetch<any[]>('/api/agents'),
  listAll: () => apiFetch<any[]>('/api/agents?all=1'),
  get: (id: string) => apiFetch<any>(`/api/agents/${id}`),
  create: (agent: any) =>
    apiCall('/api/agents', { method: 'POST', body: JSON.stringify(agent) }),
  update: (id: string, updates: any) =>
    apiCall(`/api/agents/${id}`, { method: 'PUT', body: JSON.stringify(updates) }),
};

// ─── Clock / Shifts ───────────────────────────────────────────────────────────
export const clockApi = {
  active: () => apiFetch<any[]>('/api/clock/active'),
  today: () => apiFetch<any[]>('/api/clock/today'),
  clockIn: (pin: string) =>
    apiCall('/api/clock', { method: 'POST', body: JSON.stringify({ pin }) }),
  schedule: (date: string) => apiFetch<any[]>(`/api/shift-schedule?date=${date}`),
  weekSchedule: (startDate: string, endDate: string) =>
    apiFetch<any[]>(`/api/shift-schedule?startDate=${startDate}&endDate=${endDate}`),
  saveSchedule: (data: any) =>
    apiCall('/api/shift-schedule', { method: 'POST', body: JSON.stringify(data) }),
  deleteSchedule: (id: string) =>
    apiCall(`/api/shift-schedule/${id}`, { method: 'DELETE' }),
  swapRequests: (status?: string) => {
    const q = status ? `?status=${status}` : '';
    return apiFetch<any[]>(`/api/shift-swap-requests${q}`);
  },
  createSwapRequest: (data: any) =>
    apiCall('/api/shift-swap-requests', { method: 'POST', body: JSON.stringify(data) }),
  approveSwapRequest: (id: string, data: { reviewedBy?: string; reviewNote?: string }) =>
    apiCall(`/api/shift-swap-requests/${id}/approve`, { method: 'POST', body: JSON.stringify(data) }),
  rejectSwapRequest: (id: string, data: { reviewedBy?: string; reason?: string }) =>
    apiCall(`/api/shift-swap-requests/${id}/reject`, { method: 'POST', body: JSON.stringify(data) }),
  notifyShiftChange: (data: any) =>
    apiCall('/api/notify/shift-change', { method: 'POST', body: JSON.stringify(data) }),
};

// ─── Users / Roles ────────────────────────────────────────────────────────────
export const usersApi = {
  list: () => apiFetch<any>('/api/users'),
  create: (data: any) =>
    apiCall('/api/users', { method: 'POST', body: JSON.stringify(data) }),
  delete: (id: string) =>
    apiCall(`/api/users/${id}`, { method: 'DELETE' }),
  updateRole: (id: string, role: string) =>
    apiCall(`/api/users/${id}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),
  profile: () => apiFetch<any>('/api/users/profile/me'),
  updateProfile: (data: any) =>
    apiCall('/api/users/profile/me', { method: 'PUT', body: JSON.stringify(data) }),
  portPermissions: (id: string) => apiFetch<any>(`/api/users/${id}/port-permissions`),
  extensionPermissions: (id: string) => apiFetch<any>(`/api/users/${id}/extension-permissions`),
  setPortPermissions: (id: string, ports: number[]) =>
    apiCall(`/api/users/${id}/port-permissions`, { method: 'POST', body: JSON.stringify({ ports }) }),
  setExtensionPermissions: (id: string, extensions: string[]) =>
    apiCall(`/api/users/${id}/extension-permissions`, { method: 'POST', body: JSON.stringify({ extensions }) }),
};

// ─── Contacts ─────────────────────────────────────────────────────────────────
export const contactsApi = {
  list: () => apiFetch<any[]>('/api/contacts'),
  update: (id: string, data: { name?: string; notes?: string }) =>
    apiCall(`/api/contacts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  import: (contacts: { phone_number: string; name: string }[]) =>
    apiCall('/api/contacts/import', { method: 'POST', body: JSON.stringify({ contacts }) }),
  importFromGoogle: (googleToken: string) =>
    apiCall('/api/contacts/import-from-google', { method: 'POST', body: JSON.stringify({ googleToken }) }),
  pushToGoogle: (googleToken: string) =>
    apiCall('/api/contacts/push-to-google', { method: 'POST', body: JSON.stringify({ googleToken }) }),
  merge: () =>
    apiCall('/api/contacts/merge', { method: 'POST', body: JSON.stringify({}) }),
};

// ─── Config / System ──────────────────────────────────────────────────────────
export const configApi = {
  autoReply: () => apiFetch<any>('/api/auto-reply-config'),
  saveAutoReply: (data: any) =>
    apiCall('/api/auto-reply-config', { method: 'POST', body: JSON.stringify(data) }),
  callAutoSms: () => apiFetch<any>('/api/call-auto-sms-config'),
  saveCallAutoSms: (data: any) =>
    apiCall('/api/call-auto-sms-config', { method: 'POST', body: JSON.stringify(data) }),
  smsEnabled: () => apiFetch<any>('/api/system-settings/sms-enabled'),
  setSmsEnabled: (enabled: boolean) =>
    apiCall('/api/system-settings/sms-enabled', { method: 'POST', body: JSON.stringify({ enabled }) }),
  telegramConfig: () => apiFetch<any>('/api/telegram-config'),
  saveTelegramConfig: (data: any) =>
    apiCall('/api/telegram-config', { method: 'POST', body: JSON.stringify(data) }),
  sendTelegram: (action: string) =>
    apiCall('/api/telegram-send', { method: 'POST', body: JSON.stringify({ action }) }),
  activityLogs: (params?: { limit?: number; severity?: string }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.severity) q.set('severity', params.severity);
    return apiFetch<any[]>(`/api/activity-logs?${q}`);
  },
};

// ─── Customer Ratings ────────────────────────────────────────────────────────
export const ratingsApi = {
  settings: () => apiFetch<any>('/api/ratings/settings'),
  saveSettings: (data: any) =>
    apiCall('/api/ratings/settings', { method: 'POST', body: JSON.stringify(data) }),
  analytics: (days = 30) => apiFetch<any>(`/api/ratings/analytics?days=${days}`),
  publicForm: (token: string) => apiFetch<any>(`/api/public/ratings/${encodeURIComponent(token)}`),
  submitPublic: (token: string, data: any) =>
    apiCall(`/api/public/ratings/${encodeURIComponent(token)}/submit`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

export default {
  auth: authApi,
  sms: smsApi,
  calls: callsApi,
  gateway: gatewayApi,
  agents: agentsApi,
  clock: clockApi,
  users: usersApi,
  contacts: contactsApi,
  config: configApi,
  ratings: ratingsApi,
  call: apiCall,
  fetch: apiFetch,
};

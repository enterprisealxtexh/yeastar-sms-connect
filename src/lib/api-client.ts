const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:2003').replace(/\/+$/, '');

async function apiFetch<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const token = localStorage.getItem('authToken');

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const response = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || `HTTP ${response.status}`);
  }

  return response.json();
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  register: (email: string, password: string, name?: string) =>
    apiFetch('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password, name }) }),

  logout: () =>
    apiFetch('/api/auth/logout', { method: 'POST' }),

  logActivity: (activity: any) =>
    apiFetch('/api/activity-logs', { method: 'POST', body: JSON.stringify(activity) }),
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
    apiFetch(`/api/sms-messages/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
  markAllRead: () =>
    apiFetch('/api/sms-messages/mark-all-read', { method: 'PUT' }),
  send: (phoneNumber: string, message: string) =>
    apiFetch('/api/sms-send', { method: 'POST', body: JSON.stringify({ phoneNumber, message }) }),
  getReportRecipients: () => apiFetch('/api/sms-report-recipients'),
  templates: () => apiFetch<any[]>('/api/sms-templates'),
  createTemplate: (data: { name: string; message: string }) =>
    apiFetch('/api/sms-templates', { method: 'POST', body: JSON.stringify(data) }),
  updateTemplate: (id: string, data: { name: string; message: string; active: boolean }) =>
    apiFetch(`/api/sms-templates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTemplate: (id: string) =>
    apiFetch(`/api/sms-templates/${id}`, { method: 'DELETE' }),
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
    return apiFetch<{ success: boolean; data: any[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }>(`/api/call-records?${q}`);
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
    apiFetch(`/api/call-records/${id}/callback`, {
      method: 'PUT',
      body: JSON.stringify({ callback_attempted: true, callback_notes: notes || null }),
    }),
  sendMissedCallNotify: (callerNumber: string) =>
    apiFetch('/api/missed-call-notify', { method: 'POST', body: JSON.stringify({ caller_number: callerNumber }) }),
  pbxLogs: () =>
    apiFetch('/api/pbx-call/logs', { method: 'POST', body: JSON.stringify({}) }),
};

// ─── Gateway / PBX ───────────────────────────────────────────────────────────
export const gatewayApi = {
  config: () => apiFetch<any>('/api/gateway-config'),
  saveConfig: (data: { gateway_ip?: string; api_username?: string; api_password?: string }) =>
    apiFetch('/api/gateway-config', { method: 'POST', body: JSON.stringify(data) }),
  status: () => apiFetch<any>('/api/gateway-status'),
  pbxConfig: () => apiFetch<any>('/api/pbx-config'),
  savePbxConfig: (data: any) =>
    apiFetch('/api/pbx-config', { method: 'POST', body: JSON.stringify(data) }),
  pbxStatus: () => apiFetch<any>('/api/pbx-status'),
  health: () => apiFetch('/api/health'),
  gsmSpans: () => apiFetch<any[]>('/api/gsm-spans'),
  updateGsmSpan: (gsmSpan: number, data: { name?: string | null; phone_number?: string | null }) =>
    apiFetch(`/api/gsm-spans/${gsmSpan}`, { method: 'PUT', body: JSON.stringify(data) }),
  checkGsmSpans: () => apiFetch('/api/check-gsm-spans', { method: 'POST' }),
  extensions: () => apiFetch<any>('/api/extensions'),
};

// ─── Agents ───────────────────────────────────────────────────────────────────
export const agentsApi = {
  list: () => apiFetch<any[]>('/api/agents'),
  listAll: () => apiFetch<any[]>('/api/agents?all=1'),
  get: (id: string) => apiFetch<any>(`/api/agents/${id}`),
  create: (agent: any) =>
    apiFetch('/api/agents', { method: 'POST', body: JSON.stringify(agent) }),
  update: (id: string, updates: any) =>
    apiFetch(`/api/agents/${id}`, { method: 'PUT', body: JSON.stringify(updates) }),
};

// ─── Clock / Shifts ───────────────────────────────────────────────────────────
export const clockApi = {
  active: () => apiFetch<any[]>('/api/clock/active'),
  today: () => apiFetch<any[]>('/api/clock/today'),
  clockIn: (pin: string) =>
    apiFetch('/api/clock', { method: 'POST', body: JSON.stringify({ pin }) }),
  schedule: (date: string) => apiFetch<any[]>(`/api/shift-schedule?date=${date}`),
  weekSchedule: (startDate: string, endDate: string) =>
    apiFetch<any[]>(`/api/shift-schedule?startDate=${startDate}&endDate=${endDate}`),
  saveSchedule: (data: any) =>
    apiFetch('/api/shift-schedule', { method: 'POST', body: JSON.stringify(data) }),
  deleteSchedule: (id: string) =>
    apiFetch(`/api/shift-schedule/${id}`, { method: 'DELETE' }),
  swapRequests: (status?: string) => {
    const q = status ? `?status=${status}` : '';
    return apiFetch<any[]>(`/api/shift-swap-requests${q}`);
  },
  createSwapRequest: (data: any) =>
    apiFetch('/api/shift-swap-requests', { method: 'POST', body: JSON.stringify(data) }),
  approveSwapRequest: (id: string, data: { reviewedBy?: string; reviewNote?: string }) =>
    apiFetch(`/api/shift-swap-requests/${id}/approve`, { method: 'POST', body: JSON.stringify(data) }),
  rejectSwapRequest: (id: string, data: { reviewedBy?: string; reason?: string }) =>
    apiFetch(`/api/shift-swap-requests/${id}/reject`, { method: 'POST', body: JSON.stringify(data) }),
  notifyShiftChange: (data: any) =>
    apiFetch('/api/notify/shift-change', { method: 'POST', body: JSON.stringify(data) }),
};

// ─── Users / Roles ────────────────────────────────────────────────────────────
export const usersApi = {
  list: () => apiFetch<any>('/api/users'),
  create: (data: any) =>
    apiFetch('/api/users', { method: 'POST', body: JSON.stringify(data) }),
  delete: (id: string) =>
    apiFetch(`/api/users/${id}`, { method: 'DELETE' }),
  updateRole: (id: string, role: string) =>
    apiFetch(`/api/users/${id}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),
  profile: () => apiFetch<any>('/api/users/profile/me'),
  updateProfile: (data: any) =>
    apiFetch('/api/users/profile/me', { method: 'PUT', body: JSON.stringify(data) }),
  portPermissions: (id: string) => apiFetch<any>(`/api/users/${id}/port-permissions`),
  extensionPermissions: (id: string) => apiFetch<any>(`/api/users/${id}/extension-permissions`),
  setPortPermissions: (id: string, ports: number[]) =>
    apiFetch(`/api/users/${id}/port-permissions`, { method: 'POST', body: JSON.stringify({ ports }) }),
  setExtensionPermissions: (id: string, extensions: string[]) =>
    apiFetch(`/api/users/${id}/extension-permissions`, { method: 'POST', body: JSON.stringify({ extensions }) }),
};

// ─── Contacts ─────────────────────────────────────────────────────────────────
export const contactsApi = {
  list: () => apiFetch<any[]>('/api/contacts'),
  update: (id: string, data: { name?: string; notes?: string }) =>
    apiFetch(`/api/contacts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  import: (contacts: { phone_number: string; name: string }[]) =>
    apiFetch('/api/contacts/import', { method: 'POST', body: JSON.stringify({ contacts }) }),
  importFromGoogle: (googleToken: string) =>
    apiFetch('/api/contacts/import-from-google', { method: 'POST', body: JSON.stringify({ googleToken }) }),
  pushToGoogle: (googleToken: string) =>
    apiFetch('/api/contacts/push-to-google', { method: 'POST', body: JSON.stringify({ googleToken }) }),
  merge: () =>
    apiFetch('/api/contacts/merge', { method: 'POST', body: JSON.stringify({}) }),
};

// ─── Config / System ──────────────────────────────────────────────────────────
export const configApi = {
  callAutoSms: () => apiFetch<any>('/api/call-auto-sms-config'),
  saveCallAutoSms: (data: any) =>
    apiFetch('/api/call-auto-sms-config', { method: 'POST', body: JSON.stringify(data) }),
  notificationsConfig: () => apiFetch<any>('/api/notifications-config'),
  saveNotificationsConfig: (data: any) =>
    apiFetch('/api/notifications-config', { method: 'POST', body: JSON.stringify(data) }),
  triggerSmsQueueProcessing: () =>
    apiFetch('/api/sms-queue/process', { method: 'POST', body: JSON.stringify({}) }),
  getSmsQueueStatus: () => apiFetch<any>('/api/sms-queue/status'),
  getSmsQueuePending: () => apiFetch<any>('/api/sms-queue/pending'),
  smsEnabled: () => apiFetch<any>('/api/system-settings/sms-enabled'),
  setSmsEnabled: (enabled: boolean) =>
    apiFetch('/api/system-settings/sms-enabled', { method: 'POST', body: JSON.stringify({ enabled }) }),
  sendTelegram: (action: string) =>
    apiFetch('/api/telegram-send', { method: 'POST', body: JSON.stringify({ action }) }),
  activityLogs: (params?: { limit?: number; severity?: string }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.severity) q.set('severity', params.severity);
    return apiFetch<any[]>(`/api/activity-logs?${q}`);
  },
};

// ─── Customer Ratings ────────────────────────────────────────────────────────
export const ratingsApi = {
  settings: async () => {
    const response = await apiFetch<{ success: boolean; data: any }>('/api/ratings/settings');
    return response.data || null;
  },
  saveSettings: (data: any) =>
    apiFetch('/api/ratings/settings', { method: 'POST', body: JSON.stringify(data) }),
  analytics: async (params?: {
    days?: number;
    startDate?: string;
    endDate?: string;
    agentId?: string;
    source?: string;
    extension?: string;
    minRating?: number | string;
    maxRating?: number | string;
    search?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.days != null) q.set('days', String(params.days));
    if (params?.startDate) q.set('startDate', params.startDate);
    if (params?.endDate) q.set('endDate', params.endDate);
    if (params?.agentId) q.set('agentId', params.agentId);
    if (params?.source) q.set('source', params.source);
    if (params?.extension) q.set('extension', params.extension);
    if (params?.minRating != null && String(params.minRating) !== '') q.set('minRating', String(params.minRating));
    if (params?.maxRating != null && String(params.maxRating) !== '') q.set('maxRating', String(params.maxRating));
    if (params?.search) q.set('search', params.search);
    if (params?.page != null) q.set('page', String(params.page));
    if (params?.pageSize != null) q.set('pageSize', String(params.pageSize));
    const response = await apiFetch<{ success: boolean; data: any }>(`/api/ratings/analytics?${q.toString()}`);
    return response.data || {};
  },
  publicForm: async (token: string) => {
    const response = await apiFetch<{ success: boolean; data: any }>(`/api/public/ratings/${encodeURIComponent(token)}`);
    return response.data || null;
  },
  submitPublic: (token: string, data: any) =>
    apiFetch(`/api/public/ratings/${encodeURIComponent(token)}/submit`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};
export { apiFetch };

// Compatibility wrapper used by older code: returns { success, data?, error? }
export async function apiCall<T = any>(endpoint: string, options: RequestInit = {}): Promise<{ success: boolean; data?: T; error?: string }> {
  try {
    const data = await apiFetch<T>(endpoint, options);
    return { success: true, data };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}

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
};

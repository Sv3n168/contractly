// Thin fetch wrapper for the Contractly REST API.

async function request(method, url, body, { raw = false } = {}) {
  const opts = { method, headers: {}, credentials: "same-origin" };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (res.status === 401 && !url.startsWith("/api/auth/")) {
    // Session ended (logout elsewhere, expiry, server restart): back to the login screen.
    window.dispatchEvent(new CustomEvent("auth-required"));
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = Array.isArray(data.detail)
        ? data.detail.map((d) => `${(d.loc || []).slice(-1)[0]}: ${d.msg}`).join(", ")
        : data.detail || detail;
    } catch {
      /* not JSON */
    }
    throw new Error(detail || `Fehler ${res.status}`);
  }
  if (raw) return res;
  if (res.status === 204) return null;
  return res.json();
}

const qs = (params = {}) => {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v !== undefined && v !== null && p.set(k, v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const api = {
  authStatus: () => request("GET", "/api/auth/status"),
  setup: (data) => request("POST", "/api/auth/setup", data),
  login: (data) => request("POST", "/api/auth/login", data),
  activate: (data) => request("POST", "/api/auth/activate", data),
  recover: (data) => request("POST", "/api/auth/recover", data),
  logout: () => request("POST", "/api/auth/logout"),
  me: () => request("GET", "/api/auth/me"),
  saveAccountSettings: (data) => request("PUT", "/api/auth/me/settings", data),
  changePassword: (data) => request("POST", "/api/auth/change-password", data),
  newRecoveryKey: (password) => request("POST", "/api/auth/recovery-key", { password }),
  calendarToken: () => request("GET", "/api/auth/calendar"),
  newCalendarToken: () => request("POST", "/api/auth/calendar"),
  users: () => request("GET", "/api/users"),
  inviteUser: (data) => request("POST", "/api/users", data),
  renewInvite: (id) => request("POST", `/api/users/${id}/invite`),
  setRole: (id, role) => request("PUT", `/api/users/${id}/role`, { role }),
  deleteUser: (id) => request("DELETE", `/api/users/${id}`),

  meta: () => request("GET", "/api/meta"),
  summary: (params) => request("GET", `/api/stats/summary${qs(params || {})}`),
  timeseries: (params) => request("GET", `/api/stats/timeseries${qs(params)}`),
  projection: (params) => request("GET", `/api/stats/projection${qs(params)}`),

  contracts: (params) => request("GET", `/api/contracts${qs(params)}`),
  contract: (id) => request("GET", `/api/contracts/${id}`),
  createContract: (data) => request("POST", "/api/contracts", data),
  updateContract: (id, data) => request("PUT", `/api/contracts/${id}`, data),
  deleteContract: (id) => request("DELETE", `/api/contracts/${id}`),
  cancelContract: (id, data) => request("POST", `/api/contracts/${id}/cancel`, data),
  reactivateContract: (id) => request("POST", `/api/contracts/${id}/reactivate`),
  history: (id, params) => request("GET", `/api/contracts/${id}/history${qs(params)}`),

  addPrice: (id, data) => request("POST", `/api/contracts/${id}/prices`, data),
  updatePrice: (id, pid, data) => request("PUT", `/api/contracts/${id}/prices/${pid}`, data),
  deletePrice: (id, pid) => request("DELETE", `/api/contracts/${id}/prices/${pid}`),

  addReading: (id, data) => request("POST", `/api/contracts/${id}/readings`, data),
  deleteReading: (id, rid) => request("DELETE", `/api/contracts/${id}/readings/${rid}`),

  uploadDocument: (id, file, description) => {
    const fd = new FormData();
    fd.append("file", file);
    if (description) fd.append("description", description);
    return request("POST", `/api/contracts/${id}/documents`, fd);
  },
  analyzeDocument: (file) => {
    const fd = new FormData();
    fd.append("file", file);
    return request("POST", "/api/documents/analyze", fd);
  },
  analyzeMessage: (file, { text, subject } = {}) => {
    const fd = new FormData();
    if (file) fd.append("file", file);
    if (text) fd.append("text", text);
    if (subject) fd.append("subject", subject);
    return request("POST", "/api/inbox/analyze", fd);
  },
  messageProposal: (docId, contractId) => request("GET", `/api/inbox/${docId}${qs({ contract_id: contractId })}`),
  applyMessage: (docId, data) => request("POST", `/api/inbox/${docId}/apply`, data),
  compareLoan: (id, data) => request("POST", `/api/contracts/${id}/loan/compare`, data),
  addLoanRepayment: (id, data) => request("POST", `/api/contracts/${id}/loan/repayments`, data),
  deleteLoanRepayment: (id, index) => request("DELETE", `/api/contracts/${id}/loan/repayments/${index}`),
  income: () => request("GET", "/api/income"),
  createIncomeSource: (data) => request("POST", "/api/income/sources", data),
  updateIncomeSource: (id, data) => request("PUT", `/api/income/sources/${id}`, data),
  deleteIncomeSource: (id) => request("DELETE", `/api/income/sources/${id}`),
  addIncomeEntry: (id, data) => request("POST", `/api/income/sources/${id}/entries`, data),
  deleteIncomeEntry: (id, entryId) => request("DELETE", `/api/income/sources/${id}/entries/${entryId}`),
  checkup: () => request("GET", "/api/checkup"),
  checkupDecide: (contractId, decision) => request("POST", `/api/checkup/${contractId}`, { decision }),
  checkupComplete: () => request("POST", "/api/checkup/complete"),
  emergency: () => request("GET", "/api/emergency"),
  emergencyNote: (note) => request("PUT", "/api/emergency/note", { note }),
  emergencyExport: (data) => request("POST", "/api/emergency/export", data, { raw: true }),
  extractDocument: (docId, refresh = false) => request("POST", `/api/documents/${docId}/extract${qs({ refresh })}`),
  deleteDocument: (docId) => request("DELETE", `/api/documents/${docId}`),

  offers: (id) => request("GET", `/api/contracts/${id}/offers`),
  createOffer: (id, data) => request("POST", `/api/contracts/${id}/offers`, data),
  updateOffer: (id, oid, data) => request("PUT", `/api/contracts/${id}/offers/${oid}`, data),
  deleteOffer: (id, oid) => request("DELETE", `/api/contracts/${id}/offers/${oid}`),
  evaluate: (id, params) => request("GET", `/api/contracts/${id}/offers/evaluate${qs(params)}`),
  switchOffer: (id, oid, data) => request("POST", `/api/contracts/${id}/offers/${oid}/switch`, data),

  upcoming: (params) => request("GET", `/api/reminders/upcoming${qs(params)}`),
  reminders: (params) => request("GET", `/api/reminders${qs(params)}`),
  createReminder: (data) => request("POST", "/api/reminders", data),
  updateReminder: (id, data) => request("PUT", `/api/reminders/${id}`, data),
  completeReminder: (id) => request("POST", `/api/reminders/${id}/done`),
  reopenReminder: (id, due_date) => request("POST", `/api/reminders/${id}/reopen`, { due_date }),
  undismissReminder: (key) => request("POST", `/api/reminders/undismiss${qs({ key })}`),
  deleteReminder: (id) => request("DELETE", `/api/reminders/${id}`),
  dismissReminder: (key) => request("POST", `/api/reminders/dismiss${qs({ key })}`),
  testNotification: () => request("POST", "/api/reminders/test"),

  profile: () => request("GET", "/api/profile"),
  saveProfile: (data) => request("PUT", "/api/profile", data),

  backups: () => request("GET", "/api/backups"),
  createBackup: (data) => request("POST", "/api/backups", data),
  uploadBackup: (name) => request("POST", `/api/backups/${encodeURIComponent(name)}/upload`),
  deleteBackup: (name) => request("DELETE", `/api/backups/${encodeURIComponent(name)}`),
  restoreBackup: (file, passphrase) => {
    const fd = new FormData();
    fd.append("file", file);
    if (passphrase) fd.append("passphrase", passphrase);
    return request("POST", "/api/backups/restore", fd);
  },

  demo: () => request("POST", "/api/demo"),
  resetData: (data) => request("POST", "/api/data/reset", data),

  pauseContract: (id, data) => request("POST", `/api/contracts/${id}/pause`, data),
  confirmCancellation: (id, data = {}) => request("POST", `/api/contracts/${id}/cancellation-confirmed`, data),
  noConfirmation: (id) => request("POST", `/api/contracts/${id}/no-confirmation`),
  stillUsed: (id, body) => request("POST", `/api/contracts/${id}/still-used`, body),
  unconfirmCancellation: (id) => request("DELETE", `/api/contracts/${id}/cancellation-confirmed`),

  analyzeContractList: (file) => {
    const fd = new FormData();
    fd.append("file", file);
    return request("POST", "/api/import/contracts", fd);
  },
  applyImport: (data) => request("POST", "/api/import/apply", data),

  report: (year, account) => request("GET", `/api/stats/report${qs({ year, account })}`),

  totpSetup: () => request("POST", "/api/auth/2fa/setup"),
  totpEnable: (code) => request("POST", "/api/auth/2fa/enable", { code }),
  totpDisable: (password) => request("POST", "/api/auth/2fa/disable", { password }),
  createApiToken: () => request("POST", "/api/auth/api-token"),
  revokeApiToken: () => request("DELETE", "/api/auth/api-token"),
};

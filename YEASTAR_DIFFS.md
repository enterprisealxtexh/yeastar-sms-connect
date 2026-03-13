# Yeastar Integration — File-by-file differences

Scope: comparing the current workspace `src/components` against the bundled Yeastar UI under `yeastar-sms-connect-main/src/components`.
Ignored: PBX S100 and TG400 setup/usage (no changes or work on those).

Summary
- Added: files present in the Yeastar package but not in the current `src/components`.
- Removed: files present in current `src/components` but not in Yeastar package.
- Present in both: files that exist in both locations (likely updated).

NOTE: Paths are workspace-relative. Review the listed components to open the implementation.

---

## Added files (new features / UI)
- `src/components/AgentProfilePanel.tsx` — agent profile management (PIN, extension mapping, telegram id, notification prefs).
- `src/components/AgentShiftRating.tsx` — agent ratings per shift (performance feedback).
- `src/components/AgentStatusIndicator.tsx` — small status indicator for agents.
- `src/components/AiAutomationPanel.tsx` — AI action buttons and recommendations feed (auto-config, suggestions, apply/dismiss).
- `src/components/AiConfigPanel.tsx` — AI-tunable configuration (sliders, switches, AI auto-tune).
- `src/components/AutoReplyPanel.tsx` — auto-reply SMS configuration.
- `src/components/CallAutoSmsPanel.tsx` — configure SMS templates sent after answered/missed calls.
- `src/components/CallBackButton.tsx` — UI helper for callbacks (used across reports).
- `src/components/CallStatusBadge.tsx` — small badge component for call status.
- `src/components/ClockInKiosk.tsx` — PIN-based kiosk clock in/out UI and active shifts list.
- `src/components/CommunicationsPanel.tsx` — consolidated communications tools (quick actions).
- `src/components/ErrorBoundary.tsx` — react error boundary for the app.
- `src/components/InsightsPanel.tsx` — insights and short analytics UI blocks.
- `src/components/LocalAgentGuide.tsx` — documentation/guide for local agent setup.
- `src/components/ManualSmsImport.tsx` — manual single/bulk SMS import (CSV/JSON) UI.
- `src/components/MissedCallsReportPanel.tsx` — missed-calls workflow and reporting UI.
- `src/components/NavLink.tsx` — nav link helper component.
- `src/components/NotificationSettingsPanel.tsx` — notification/email/telegram settings UI.
- `src/components/PredictiveMaintenancePanel.tsx` — AI-driven system health checks and auto-optimization.
- `src/components/RoleManagementPanel.tsx` — user roles, create users, generate kiosk PINs, role hierarchy.
- `src/components/SendReportDialog.tsx` — dialog to send consolidated reports (used by missed calls, analytics).
- `src/components/ShiftSwapPanel.tsx` — shift-swap request workflow (create, approve/reject, history).
- `src/components/SimPortCard.tsx` — SIM port display card (per-port status/info).
- `src/components/SimPortConfigSection.tsx` — SIM port configuration UI section.
- `src/components/SmsCategoryFeedback.tsx` — SMS category feedback UI used for AI learning.
- `src/components/StaffPanel.tsx` — tabbed staff area (kiosk, profiles, supervisor panels).
- `src/components/StatusIndicator.tsx` — generic status indicator UI.
- `src/components/SupervisorPanel.tsx` — supervisor dashboard (live board, today log, create agent/schedule).
- `src/components/TelegramPanel.tsx` — Telegram reports/actions UI.
- `src/components/WeeklyShiftPlanner.tsx` — drag & drop weekly planner and bulk scheduling.

These new components enable large features: agent/staff management, shift scheduling and swapping, AI recommendations & tuning, predictive maintenance, manual SMS import, missed-call workflows, and Telegram reporting.

## Removed / replaced files (present in current but not in Yeastar bundle)
- `src/components/AllSmsPanel.tsx` — appears in current workspace but not in Yeastar bundle.
- `src/components/CallsSummaryPanel.tsx` — present previously, not in Yeastar bundle.
- `src/components/ExtensionsPanel.tsx` — removed in Yeastar package.
- `src/components/GoogleAuthModal.tsx` — not present in Yeastar bundle.
- `src/components/GsmSpanSettingsForm.tsx` — replaced/renamed (see `SimPortConfigSection.tsx` / `SimPortCard.tsx`).
- `src/components/MissedCallRulesTab.tsx` — replaced by integrated Missed Calls UI and Auto-Reply settings.
- `src/components/SimPortSettingsForm.tsx` — replaced by `SimPortConfigSection` / `SimPortCard`.
- `src/components/SystemFooter.tsx` — removed or refactored into layout in Yeastar bundle.
- `src/components/TelegramSettingsForm.tsx` — Telegram integration moved to `TelegramPanel`.
- `src/components/TemplateModal.tsx` — templates UI refactored (templates still present but reorganized).

## Present in both (likely updated)
These files exist in both codebases — they are likely updated in the Yeastar package to integrate new features:
- `src/components/ActivityLog.tsx`
- `src/components/AnalyticsDashboard.tsx`
- `src/components/CallQueueStatus.tsx`
- `src/components/CallRecordsTable.tsx`
- `src/components/CallStatsCards.tsx`
- `src/components/ConfigurationPanel.tsx`
- `src/components/ContactsPanel.tsx` *(extended: Google CSV export/import, merge duplicates, edit inline)*
- `src/components/DashboardSidebar.tsx`
- `src/components/ErrorLogsPanel.tsx`
- `src/components/GatewaySettingsForm.tsx` *(logging observed in file — likely more robust save/touchpoints)*
- `src/components/Header.tsx`
- `src/components/PbxSettingsForm.tsx`
- `src/components/ProtectedRoute.tsx`
- `src/components/QuickDialWidget.tsx`
- `src/components/SmsCategoryBadge.tsx`
- `src/components/SmsFilters.tsx`
- `src/components/SmsInbox.tsx`
- `src/components/SystemStatusCard.tsx`
- `src/components/UserProfilePanel.tsx`

Recommendation: open these files in your editor to review the exact changes; many include additional hooks and integrations with `supabase` functions and AI endpoints.

## Notable new functional areas (high level)
- Agent & staff management: kiosk clock-in/out, PIN management, extension mapping, Telegram notifications, role-based access control.
- Scheduling: drag & drop weekly planner, bulk scheduling, inline editing, reassignments with reasons, shift-swap requests.
- AI features: automation actions, recommendation feed, predictive maintenance, AI-driven config tuning and SMS classification learning.
- Missed-call & callback workflows: report generation, email/Telegram notifications, mark callbacks, SMS auto-replies.
- SIM & gateway improvements: per-port UI (`SimPortCard`), consolidated SIM config section, gateway tuning hooks.
- Manual data import: CSV/JSON bulk importers for SMS and contacts with validation.

---

## How I produced this
- Directory listings compared: `src/components` (current) vs `yeastar-sms-connect-main/src/components` (Yeastar bundle).
- I inspected key files for functionality notes (e.g. `ContactsPanel.tsx`, `ClockInKiosk.tsx`, `AiAutomationPanel.tsx`, `WeeklyShiftPlanner.tsx`).

## Next actions (pick one)
- I can produce a prioritized implementation roadmap to integrate selected Yeastar features into your main app.
- I can open and produce a detailed diff (per-file code diff) for files present in both.
- I can scaffold missing backend hooks / supabase functions for specific features (e.g., clock-in, shift scheduling).

Tell me which next action you want and I will proceed.

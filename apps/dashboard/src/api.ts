import type { Appeal, AuditLog, GuildConfig, ModerationCase } from '@apexbot/shared';

export interface Guild { id: string; name: string; icon: string | null; memberCount: number }
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(8000),
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? `Request failed (${response.status})`);
  return response.json() as Promise<T>;
}
export const api = {
  session: () => request<{ authenticated: boolean; user: { id: string; username: string } }>('/api/auth/session'),
  guilds: () => request<Guild[]>('/api/guilds'),
  config: (id: string) => request<GuildConfig>(`/api/guilds/${id}/config`),
  cases: (id: string) => request<ModerationCase[]>(`/api/guilds/${id}/cases`),
  logs: (id: string) => request<AuditLog[]>(`/api/guilds/${id}/logs`),
  appeals: (id: string) => request<Appeal[]>(`/api/guilds/${id}/appeals`),
  resources: (id: string) => request<{ channels: Array<{ id: string; name: string }>; roles: Array<{ id: string; name: string; color: string }> }>(`/api/guilds/${id}/resources`),
  updateConfig: (id: string, patch: Partial<GuildConfig>) => request<GuildConfig>(`/api/guilds/${id}/config`, { method: 'PATCH', body: JSON.stringify(patch) }),
};

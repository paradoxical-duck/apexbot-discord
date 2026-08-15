import { LRUCache } from 'lru-cache';

const BASE_URL = 'https://api.ftcscout.org/rest/v1';

export interface FtcTeam {
  number: number; name: string; schoolName: string | null; sponsors: string[];
  country: string; state: string; city: string; rookieYear: number; website: string | null;
}
export interface RankedMetric { value: number; rank: number }
export interface QuickStats { season: number; number: number; tot: RankedMetric; auto: RankedMetric; dc: RankedMetric; eg: RankedMetric; count: number }
export interface TeamEvent { season: number; eventCode: string; teamNumber: number; isRemote: boolean; stats: null | { rank: number; wins: number; losses: number; ties: number; dqs: number; qualMatchesPlayed: number; rp: number; opr?: Record<string, number>; avg?: Record<string, number> } }
export interface TeamMatch { season: number; eventCode: string; matchId: number; alliance: 'Red' | 'Blue'; station: string; teamNumber: number; surrogate: boolean; noShow: boolean; dq: boolean }
export interface EventSummary { season: number; code: string; name: string; type: string; regionCode: string; leagueCode: string | null; districtCode: string | null; venue: string | null; city: string | null; state: string | null; country: string | null; start: string; end: string; website: string | null }
export interface Award { season: number; eventCode: string; teamNumber: number | null; personName: string | null; type: string; placement: number }

export function currentFtcSeason(date = new Date()): number {
  return date.getUTCMonth() >= 8 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
}

export class FtcScoutClient {
  private cache = new LRUCache<string, any>({ max: 500, ttl: 5 * 60 * 1000 });
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequest = 0;

  private async request<T>(path: string, ttl = 5 * 60 * 1000): Promise<T> {
    const cached = this.cache.get(path);
    if (cached !== undefined) return cached as T;
    const operation = this.queue.then(async () => {
      const wait = Math.max(0, 250 - (Date.now() - this.lastRequest));
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastRequest = Date.now();
      const response = await fetch(`${BASE_URL}${path}`, { headers: { 'user-agent': 'ApexBot/0.1 (Discord FTC utility)' }, signal: AbortSignal.timeout(8000) });
      if (response.status === 404) throw new Error('FTCScout could not find that team or event.');
      if (!response.ok) throw new Error(`FTCScout request failed (${response.status}).`);
      const data = await response.json() as T;
      this.cache.set(path, data, { ttl });
      return data;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  team(number: number): Promise<FtcTeam> { return this.request(`/teams/${number}`, 60 * 60 * 1000); }
  search(query: string, limit = 5): Promise<FtcTeam[]> { return this.request(`/teams/search?limit=${limit}&searchText=${encodeURIComponent(query)}`); }
  stats(number: number, season = currentFtcSeason()): Promise<QuickStats> { return this.request(`/teams/${number}/quick-stats?season=${season}`); }
  events(number: number, season = currentFtcSeason()): Promise<TeamEvent[]> { return this.request(`/teams/${number}/events/${season}`); }
  matches(number: number, season = currentFtcSeason(), eventCode?: string): Promise<TeamMatch[]> {
    const query = new URLSearchParams({ season: String(season) });
    if (eventCode) query.set('eventCode', eventCode);
    return this.request(`/teams/${number}/matches?${query}`);
  }
  awards(number: number, season = currentFtcSeason(), eventCode?: string): Promise<Award[]> {
    const query = new URLSearchParams({ season: String(season) });
    if (eventCode) query.set('eventCode', eventCode);
    return this.request(`/teams/${number}/awards?${query}`);
  }
  event(code: string, season = currentFtcSeason()): Promise<EventSummary> { return this.request(`/events/${season}/${encodeURIComponent(code.toUpperCase())}`, 30 * 60 * 1000); }
  eventMatches(code: string, season = currentFtcSeason()): Promise<any[]> { return this.request(`/events/${season}/${encodeURIComponent(code.toUpperCase())}/matches`, 60 * 1000); }
  eventTeams(code: string, season = currentFtcSeason()): Promise<TeamEvent[]> { return this.request(`/events/${season}/${encodeURIComponent(code.toUpperCase())}/teams`, 5 * 60 * 1000); }
  eventAwards(code: string, season = currentFtcSeason()): Promise<Award[]> { return this.request(`/events/${season}/${encodeURIComponent(code.toUpperCase())}/awards`, 10 * 60 * 1000); }
}

export const ftcScout = new FtcScoutClient();

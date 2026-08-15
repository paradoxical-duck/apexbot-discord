import { randomUUID } from 'node:crypto';
import { cert, getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Firestore, getFirestore } from 'firebase-admin/firestore';
import type { ActiveSanction, Appeal, AppealStatus, AuditLog, GuildConfig, ModerationCase, UserProgression } from '@apexbot/shared';
import { DEFAULT_GUILD_CONFIG } from '@apexbot/shared';
import { env } from '../env.js';
import { logger } from '../logger.js';

function initializeFirebase(): Firestore | null {
  if (!env.FIREBASE_PROJECT_ID && !env.FIREBASE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) return null;
  try {
    const credential = env.FIREBASE_SERVICE_ACCOUNT_JSON
      ? cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON))
      : applicationDefault();
    if (!getApps().length) initializeApp({ credential, ...(env.FIREBASE_PROJECT_ID ? { projectId: env.FIREBASE_PROJECT_ID } : {}) });
    return getFirestore();
  } catch (error) {
    logger.warn({ error }, 'Firebase unavailable; using in-memory development store');
    return null;
  }
}

export const firestore = initializeFirebase();
const configs = new Map<string, GuildConfig>();
const progressions = new Map<string, UserProgression>();
const cases = new Map<string, ModerationCase>();
const logs = new Map<string, AuditLog>();
const appeals = new Map<string, Appeal>();
const sanctions = new Map<string, ActiveSanction>();
const configListeners = new Set<(guildId: string) => void>();
const logListeners = new Set<(record: AuditLog) => void>();

export class ApexStore {
  async getGuildConfig(guildId: string, guildName = 'Discord server'): Promise<GuildConfig> {
    if (firestore) {
      const ref = firestore.doc(`guilds/${guildId}`);
      const snap = await ref.get();
      if (snap.exists) return { guildId, guildName, ...DEFAULT_GUILD_CONFIG, ...snap.data() } as GuildConfig;
      const config: GuildConfig = { guildId, guildName, ...DEFAULT_GUILD_CONFIG, updatedAt: new Date().toISOString() };
      await ref.set(config);
      return config;
    }
    const existing = configs.get(guildId);
    if (existing) return existing;
    const config: GuildConfig = { guildId, guildName, ...DEFAULT_GUILD_CONFIG, updatedAt: new Date().toISOString() };
    configs.set(guildId, config);
    return config;
  }

  async updateGuildConfig(guildId: string, patch: Partial<GuildConfig>): Promise<GuildConfig> {
    const current = await this.getGuildConfig(guildId);
    const safePatch = { ...patch };
    delete safePatch.guildId;
    const next = { ...current, ...safePatch, guildId, updatedAt: new Date().toISOString() };
    if (firestore) await firestore.doc(`guilds/${guildId}`).set(next, { merge: true });
    else configs.set(guildId, next);
    for (const listener of configListeners) listener(guildId);
    return next;
  }

  onConfigUpdate(listener: (guildId: string) => void): () => void {
    configListeners.add(listener);
    return () => configListeners.delete(listener);
  }

  async getProgression(guildId: string, userId: string): Promise<UserProgression> {
    const key = `${guildId}:${userId}`;
    let current: UserProgression | null = null;
    if (firestore) {
      const snap = await firestore.doc(`guilds/${guildId}/members/${userId}`).get();
      if (snap.exists) current = snap.data() as UserProgression;
    } else if (progressions.has(key)) current = progressions.get(key)!;
    current ??= { guildId, userId, pc: 0, pcEntries: [], warnings: 0, lastOffenseAt: null, updatedAt: new Date().toISOString() };
    const fallbackStamp = current.lastOffenseAt ?? current.updatedAt;
    const entries = current.pcEntries ?? Array.from({ length: current.pc }, () => fallbackStamp);
    const config = await this.getGuildConfig(guildId);
    const activeEntries = config.pcExpiryDays == null ? entries : entries.filter((stamp) => Date.parse(stamp) >= Date.now() - config.pcExpiryDays! * 86_400_000);
    const normalized = { ...current, pc: activeEntries.length, pcEntries: activeEntries };
    if (activeEntries.length !== current.pc || !current.pcEntries) {
      if (firestore) await firestore.doc(`guilds/${guildId}/members/${userId}`).set(normalized);
      else progressions.set(key, normalized);
    }
    return normalized;
  }

  async adjustProgression(guildId: string, userId: string, delta: number, reset = false): Promise<UserProgression> {
    const current = await this.getProgression(guildId, userId);
    const targetPc = reset ? 0 : Math.min(10, Math.max(0, current.pc + delta));
    const entries = reset ? [] : delta > 0 ? [...current.pcEntries, ...Array.from({ length: delta }, () => new Date().toISOString())].slice(0, targetPc) : current.pcEntries.slice(0, targetPc);
    const next: UserProgression = {
      ...current,
      pc: targetPc,
      pcEntries: entries,
      warnings: delta > 0 ? current.warnings + 1 : reset ? 0 : current.warnings,
      lastOffenseAt: delta > 0 ? new Date().toISOString() : current.lastOffenseAt,
      updatedAt: new Date().toISOString(),
    };
    if (firestore) await firestore.doc(`guilds/${guildId}/members/${userId}`).set(next);
    else progressions.set(`${guildId}:${userId}`, next);
    return next;
  }

  async setProgression(guildId: string, userId: string, pc: number): Promise<UserProgression> {
    const current = await this.getProgression(guildId, userId);
    const targetPc = Math.min(10, Math.max(0, Math.round(pc)));
    const next: UserProgression = { ...current, pc: targetPc, pcEntries: targetPc > current.pc ? [...current.pcEntries, ...Array.from({ length: targetPc - current.pc }, () => new Date().toISOString())] : current.pcEntries.slice(0, targetPc), updatedAt: new Date().toISOString() };
    if (firestore) await firestore.doc(`guilds/${guildId}/members/${userId}`).set(next);
    else progressions.set(`${guildId}:${userId}`, next);
    return next;
  }

  async advanceOffense(guildId: string, userId: string, delta = 1, maximumPc = 10): Promise<{ before: UserProgression; after: UserProgression; phase: 'verbal' | 'official' | 'pc' }> {
    const before = await this.getProgression(guildId, userId);
    const phase = before.pc === 0 && before.warnings === 0 ? 'verbal' : before.pc === 0 ? 'official' : 'pc';
    const after: UserProgression = {
      ...before,
      pc: phase === 'official' ? 1 : phase === 'pc' ? Math.min(maximumPc, before.pc + Math.max(1, delta)) : before.pc,
      pcEntries: phase === 'verbal' ? before.pcEntries : [...before.pcEntries, new Date().toISOString()].slice(0, maximumPc),
      warnings: before.warnings + 1,
      lastOffenseAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (firestore) await firestore.doc(`guilds/${guildId}/members/${userId}`).set(after);
    else progressions.set(`${guildId}:${userId}`, after);
    return { before, after, phase };
  }

  async createCase(input: Omit<ModerationCase, 'id' | 'createdAt'>): Promise<ModerationCase> {
    const record = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    if (firestore) await firestore.doc(`guilds/${input.guildId}/cases/${record.id}`).set(record);
    else cases.set(record.id, record);
    return record;
  }

  async findCase(guildId: string, reference: string): Promise<ModerationCase | null> {
    const normalized = reference.trim().toLowerCase();
    const rows = await this.listCases(guildId, 500);
    const exact = rows.find((item) => item.id.toLowerCase() === normalized);
    if (exact) return exact;
    const matches = rows.filter((item) => item.id.toLowerCase().startsWith(normalized));
    return matches.length === 1 ? matches[0]! : null;
  }

  async updateCase(guildId: string, caseId: string, patch: Partial<ModerationCase>): Promise<ModerationCase> {
    const current = await this.findCase(guildId, caseId);
    if (!current) throw new Error('Case not found.');
    const next = { ...current, ...patch, id: current.id, guildId: current.guildId };
    if (firestore) await firestore.doc(`guilds/${guildId}/cases/${current.id}`).set(next, { merge: true });
    else cases.set(current.id, next);
    return next;
  }

  async createAppeal(input: Omit<Appeal, 'id' | 'createdAt' | 'resolvedAt' | 'moderatorId' | 'moderatorNote' | 'status'>): Promise<Appeal> {
    const record: Appeal = { ...input, id: randomUUID(), status: 'pending', moderatorId: null, moderatorNote: null, createdAt: new Date().toISOString(), resolvedAt: null };
    if (firestore) await firestore.doc(`guilds/${input.guildId}/appeals/${record.id}`).set(record);
    else appeals.set(record.id, record);
    return record;
  }

  async listAppeals(guildId: string, limit = 100): Promise<Appeal[]> {
    if (firestore) {
      const snap = await firestore.collection(`guilds/${guildId}/appeals`).orderBy('createdAt', 'desc').limit(limit).get();
      return snap.docs.map((doc) => doc.data() as Appeal);
    }
    return [...appeals.values()].filter((item) => item.guildId === guildId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  async findAppeal(guildId: string, caseReference: string): Promise<Appeal | null> {
    const caseRecord = await this.findCase(guildId, caseReference);
    if (!caseRecord) return null;
    return (await this.listAppeals(guildId, 500)).find((item) => item.caseId === caseRecord.id) ?? null;
  }

  async resolveAppeal(guildId: string, appealId: string, status: Exclude<AppealStatus, 'pending'>, moderatorId: string, note: string): Promise<Appeal> {
    const current = (await this.listAppeals(guildId, 500)).find((item) => item.id === appealId);
    if (!current) throw new Error('Appeal not found.');
    const next: Appeal = { ...current, status, moderatorId, moderatorNote: note || null, resolvedAt: new Date().toISOString() };
    if (firestore) await firestore.doc(`guilds/${guildId}/appeals/${appealId}`).set(next, { merge: true });
    else appeals.set(appealId, next);
    return next;
  }

  async createSanction(input: Omit<ActiveSanction, 'id' | 'createdAt' | 'liftedAt' | 'active'>): Promise<ActiveSanction> {
    const record: ActiveSanction = { ...input, id: randomUUID(), active: true, createdAt: new Date().toISOString(), liftedAt: null };
    if (firestore) await firestore.doc(`guilds/${input.guildId}/sanctions/${record.id}`).set(record);
    else sanctions.set(record.id, record);
    return record;
  }

  async listActiveSanctions(guildId?: string): Promise<ActiveSanction[]> {
    if (firestore) {
      const query = guildId ? firestore.collection(`guilds/${guildId}/sanctions`).where('active', '==', true) : firestore.collectionGroup('sanctions').where('active', '==', true);
      const snap = await query.get();
      return snap.docs.map((doc) => doc.data() as ActiveSanction);
    }
    return [...sanctions.values()].filter((item) => item.active && (!guildId || item.guildId === guildId));
  }

  async liftSanction(guildId: string, sanctionId: string): Promise<void> {
    if (firestore) await firestore.doc(`guilds/${guildId}/sanctions/${sanctionId}`).set({ active: false, liftedAt: new Date().toISOString() }, { merge: true });
    else {
      const current = sanctions.get(sanctionId);
      if (current) sanctions.set(sanctionId, { ...current, active: false, liftedAt: new Date().toISOString() });
    }
  }

  async createLog(input: Omit<AuditLog, 'id' | 'createdAt'>): Promise<AuditLog> {
    const record = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    if (firestore) await firestore.doc(`guilds/${input.guildId}/logs/${record.id}`).set({ ...record, serverCreatedAt: FieldValue.serverTimestamp() });
    else logs.set(record.id, record);
    for (const listener of logListeners) listener(record);
    return record;
  }

  onLog(listener: (record: AuditLog) => void): () => void {
    logListeners.add(listener);
    return () => logListeners.delete(listener);
  }

  async listCases(guildId: string, limit = 100): Promise<ModerationCase[]> {
    if (firestore) {
      const snap = await firestore.collection(`guilds/${guildId}/cases`).orderBy('createdAt', 'desc').limit(limit).get();
      return snap.docs.map((d) => d.data() as ModerationCase);
    }
    return [...cases.values()].filter((c) => c.guildId === guildId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  async listLogs(guildId: string, limit = 100): Promise<AuditLog[]> {
    if (firestore) {
      const snap = await firestore.collection(`guilds/${guildId}/logs`).orderBy('createdAt', 'desc').limit(limit).get();
      return snap.docs.map((d) => d.data() as AuditLog);
    }
    return [...logs.values()].filter((l) => l.guildId === guildId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  async createCustomToken(userId: string, guilds: string[]): Promise<string> {
    if (!firestore) throw new Error('Firebase Admin is required for Discord dashboard authentication.');
    return getAuth().createCustomToken(userId, { guilds });
  }
}

export const store = new ApexStore();

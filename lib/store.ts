import { Redis } from "@upstash/redis";
import type { HostAccount, HostRecord, MoimEvent, MoimResponse } from "./types";

/**
 * 저장소 계층.
 * - 배포 환경: Upstash Redis (Vercel Marketplace에서 연결하면 환경변수가 자동 주입됨)
 * - 로컬 개발: 환경변수가 없으면 메모리에 저장 (서버 재시작 시 사라짐)
 */

const TTL_SECONDS = 60 * 60 * 24 * 120; // 마지막 수정 후 120일 뒤 자동 삭제

export class StoreNotConfiguredError extends Error {
  constructor() {
    super("저장소(Upstash Redis)가 연결되지 않았습니다.");
    this.name = "StoreNotConfiguredError";
  }
}

type StoredResponse = {
  relation?: string;
  station?: string;
  unavailable: string[];
  updatedAt: number;
  /** 이 응답을 고칠 수 있는 토큰의 해시 (응답한 기기만 토큰을 안다) */
  editHash?: string;
  /** 응답한 기기(브라우저)를 나타내는 토큰의 해시. 한 기기에서 여러 번 응답하는 것을 막는 데 쓴다 */
  deviceHash?: string;
};

export type ResponseMeta = { editHash: string; deviceHash: string };

interface Store {
  createEvent(event: MoimEvent): Promise<void>;
  getEvent(id: string): Promise<MoimEvent | null>;
  deleteEvent(id: string): Promise<void>;
  /** 정해진 시간 동안 같은 키로 몇 번째 요청인지 센다 (도배 방지용) */
  hit(key: string, windowSeconds: number): Promise<number>;
  /** 이름 검색 목록에 올리거나(true) 내린다(false) */
  setIndexed(event: MoimEvent, indexed: boolean): Promise<void>;
  /** 검색 목록에 있는 최근 모임들 (최신순) */
  listIndexed(limit: number): Promise<MoimEvent[]>;
  listResponses(id: string): Promise<MoimResponse[]>;
  countResponses(id: string): Promise<number>;
  /** 응답이 없으면 null. 있으면 수정 토큰 해시와 기기 해시(예전 응답은 빈 문자열) */
  getResponseMeta(id: string, name: string): Promise<ResponseMeta | null>;
  /** 이 기기로 이미 응답한 이름 (없으면 null) */
  findNameByDevice(id: string, deviceHash: string): Promise<string | null>;
  putResponse(
    id: string,
    response: MoimResponse,
    meta: ResponseMeta,
  ): Promise<void>;
  deleteResponse(id: string, name: string): Promise<void>;
  getHost(hostHash: string): Promise<HostRecord | null>;
  putHost(hostHash: string, record: HostRecord): Promise<void>;
  /** 모임을 모임장에게 묶거나(true) 푼다(false) */
  linkHostEvent(
    hostHash: string,
    eventId: string,
    linked: boolean,
  ): Promise<void>;
  /** 모임장이 만든 모임들 */
  listHostEvents(hostHash: string): Promise<MoimEvent[]>;
  deleteHost(hostHash: string): Promise<void>;
  /** 지금까지 센 횟수 (hit 으로 센 값을 늘리지 않고 읽기만 한다) */
  peek(key: string): Promise<number>;
  getAccount(id: string): Promise<HostAccount | null>;
  /** 같은 아이디가 이미 있으면 만들지 않고 false */
  createAccount(account: HostAccount): Promise<boolean>;
  /** 모임장 해시가 어느 계정의 것인지 */
  getHostAccount(hostHash: string): Promise<string | null>;
  setHostAccount(hostHash: string, accountId: string): Promise<void>;
  /** 로그인 세션: 세션 토큰의 해시 → 모임장 해시 */
  putSession(sessionHash: string, hostHash: string): Promise<void>;
  getSessionHost(sessionHash: string): Promise<string | null>;
  deleteSession(sessionHash: string): Promise<void>;
}

const eventKey = (id: string) => `mp:event:${id}`;
const responsesKey = (id: string) => `mp:event:${id}:responses`;
const hostKey = (hash: string) => `mp:host:${hash}`;
const hostEventsKey = (hash: string) => `mp:host:${hash}:events`;
const HOST_TTL_SECONDS = 60 * 60 * 24 * 400;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 200;
const accountKey = (id: string) => `mp:account:${id}`;
const hostAccountKey = (hash: string) => `mp:hostacct:${hash}`;
const sessionKey = (hash: string) => `mp:session:${hash}`;
const INDEX_KEY = "mp:index"; // 정렬 집합: 점수 = 만든 시각, 값 = 모임 ID

/**
 * Vercel 연동 방식에 따라 환경변수 이름이 다르다.
 *  - Upstash 직접 설정: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 *  - Vercel Marketplace: KV_REST_API_URL / KV_REST_API_TOKEN (접두사를 바꾼 경우 포함)
 */
function findCredentials(): { url: string; token: string } | null {
  const env = process.env;
  const pairs: [string, string][] = [
    ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
    ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
  ];
  for (const [u, t] of pairs) {
    if (env[u] && env[t])
      return { url: env[u] as string, token: env[t] as string };
  }
  // 연결할 때 접두사를 직접 지정한 경우 (예: MOIM_KV_REST_API_URL)
  for (const key of Object.keys(env)) {
    for (const [uSuffix, tSuffix] of [
      ["_KV_REST_API_URL", "_KV_REST_API_TOKEN"],
      ["_REDIS_REST_URL", "_REDIS_REST_TOKEN"],
    ]) {
      if (key.endsWith(uSuffix)) {
        const tokenKey = key.slice(0, -uSuffix.length) + tSuffix;
        if (env[key] && env[tokenKey]) {
          return { url: env[key] as string, token: env[tokenKey] as string };
        }
      }
    }
  }
  return null;
}

function redisStore(redis: Redis): Store {
  return {
    async createEvent(event) {
      await redis.set(eventKey(event.id), event, { ex: TTL_SECONDS });
    },
    async getEvent(id) {
      return (await redis.get<MoimEvent>(eventKey(id))) ?? null;
    },
    async deleteEvent(id) {
      await redis.del(eventKey(id), responsesKey(id));
      await redis.zrem(INDEX_KEY, id);
    },
    async deleteHost(hostHash) {
      await redis.del(hostKey(hostHash), hostEventsKey(hostHash));
    },
    async peek(key) {
      return Number((await redis.get<number>(`mp:rate:${key}`)) ?? 0);
    },
    async getAccount(id) {
      return (await redis.get<HostAccount>(accountKey(id))) ?? null;
    },
    async createAccount(account) {
      return (
        (await redis.set(accountKey(account.id), account, { nx: true })) ===
        "OK"
      );
    },
    async getHostAccount(hostHash) {
      const id = await redis.get<string | number>(hostAccountKey(hostHash));
      return id === null || id === undefined ? null : String(id);
    },
    async setHostAccount(hostHash, accountId) {
      await redis.set(hostAccountKey(hostHash), accountId);
    },
    async putSession(sessionHash, hostHash) {
      await redis.set(sessionKey(sessionHash), hostHash, {
        ex: SESSION_TTL_SECONDS,
      });
    },
    async getSessionHost(sessionHash) {
      return (await redis.get<string>(sessionKey(sessionHash))) ?? null;
    },
    async deleteSession(sessionHash) {
      await redis.del(sessionKey(sessionHash));
    },
    async hit(key, windowSeconds) {
      const count = await redis.incr(`mp:rate:${key}`);
      if (count === 1) await redis.expire(`mp:rate:${key}`, windowSeconds);
      return count;
    },
    async setIndexed(event, indexed) {
      if (indexed)
        await redis.zadd(INDEX_KEY, {
          score: event.createdAt,
          member: event.id,
        });
      else await redis.zrem(INDEX_KEY, event.id);
    },
    async listIndexed(limit) {
      const ids = await redis.zrange<string[]>(INDEX_KEY, 0, limit - 1, {
        rev: true,
      });
      if (ids.length === 0) return [];
      const events = await redis.mget<(MoimEvent | null)[]>(
        ...ids.map(eventKey),
      );
      // 기한이 지나 사라진 모임은 목록에서도 치운다
      const gone = ids.filter((_, i) => !events[i]);
      if (gone.length > 0) await redis.zrem(INDEX_KEY, ...gone);
      return events.filter((e): e is MoimEvent => Boolean(e));
    },
    async listResponses(id) {
      const all = await redis.hgetall<Record<string, StoredResponse>>(
        responsesKey(id),
      );
      if (!all) return [];
      return Object.entries(all).map(([name, value]) => ({
        name,
        relation: typeof value?.relation === "string" ? value.relation : "",
        station: typeof value?.station === "string" ? value.station : "",
        unavailable: Array.isArray(value?.unavailable) ? value.unavailable : [],
        updatedAt: Number(value?.updatedAt) || 0,
      }));
    },
    async countResponses(id) {
      return await redis.hlen(responsesKey(id));
    },
    async getResponseMeta(id, name) {
      const value = await redis.hget<StoredResponse>(responsesKey(id), name);
      return value
        ? { editHash: value.editHash ?? "", deviceHash: value.deviceHash ?? "" }
        : null;
    },
    async findNameByDevice(id, deviceHash) {
      const all = await redis.hgetall<Record<string, StoredResponse>>(
        responsesKey(id),
      );
      if (!all) return null;
      const hit = Object.entries(all).find(
        ([, value]) => value?.deviceHash === deviceHash,
      );
      return hit ? hit[0] : null;
    },
    async putResponse(id, response, meta) {
      const value: StoredResponse = {
        editHash: meta.editHash,
        deviceHash: meta.deviceHash,
        relation: response.relation,
        station: response.station,
        unavailable: response.unavailable,
        updatedAt: response.updatedAt,
      };
      await redis.hset(responsesKey(id), { [response.name]: value });
      await Promise.all([
        redis.expire(responsesKey(id), TTL_SECONDS),
        redis.expire(eventKey(id), TTL_SECONDS),
      ]);
    },
    async deleteResponse(id, name) {
      await redis.hdel(responsesKey(id), name);
    },
    async getHost(hostHash) {
      return (await redis.get<HostRecord>(hostKey(hostHash))) ?? null;
    },
    async putHost(hostHash, record) {
      await redis.set(hostKey(hostHash), record, { ex: HOST_TTL_SECONDS });
    },
    async linkHostEvent(hostHash, eventId, linked) {
      if (linked) {
        await redis.sadd(hostEventsKey(hostHash), eventId);
        await redis.expire(hostEventsKey(hostHash), HOST_TTL_SECONDS);
      } else {
        await redis.srem(hostEventsKey(hostHash), eventId);
      }
    },
    async listHostEvents(hostHash) {
      const ids = await redis.smembers(hostEventsKey(hostHash));
      if (ids.length === 0) return [];
      const events = await redis.mget<(MoimEvent | null)[]>(
        ...ids.map(eventKey),
      );
      const gone = ids.filter((_, i) => !events[i]);
      if (gone.length > 0) await redis.srem(hostEventsKey(hostHash), ...gone);
      return events.filter((e): e is MoimEvent => Boolean(e));
    },
  };
}

function memoryStore(): Store {
  const g = globalThis as unknown as {
    __moimEvents?: Map<string, MoimEvent>;
    __moimResponses?: Map<string, Map<string, StoredResponse>>;
    __moimIndex?: Set<string>;
    __moimHosts?: Map<string, HostRecord>;
    __moimHostEvents?: Map<string, Set<string>>;
    __moimAccounts?: Map<string, HostAccount>;
    __moimHostAccounts?: Map<string, string>;
    __moimSessions?: Map<string, string>;
    __moimHits?: Map<string, { count: number; until: number }>;
  };
  const events = (g.__moimEvents ??= new Map());
  const responses = (g.__moimResponses ??= new Map());
  const index = (g.__moimIndex ??= new Set<string>());
  const hosts = (g.__moimHosts ??= new Map<string, HostRecord>());
  const hostEvents = (g.__moimHostEvents ??= new Map<string, Set<string>>());
  const hits = (g.__moimHits ??= new Map<
    string,
    { count: number; until: number }
  >());
  const accounts = (g.__moimAccounts ??= new Map<string, HostAccount>());
  const hostAccounts = (g.__moimHostAccounts ??= new Map<string, string>());
  const sessions = (g.__moimSessions ??= new Map<string, string>());
  const bucket = (id: string) => {
    let b = responses.get(id);
    if (!b) {
      b = new Map();
      responses.set(id, b);
    }
    return b;
  };
  return {
    async createEvent(event) {
      events.set(event.id, event);
    },
    async getEvent(id) {
      return events.get(id) ?? null;
    },
    async deleteEvent(id) {
      events.delete(id);
      responses.delete(id);
      index.delete(id);
    },
    async deleteHost(hostHash) {
      hosts.delete(hostHash);
      hostEvents.delete(hostHash);
    },
    async peek(key) {
      const entry = hits.get(key);
      return entry && entry.until >= Date.now() ? entry.count : 0;
    },
    async getAccount(id) {
      return accounts.get(id) ?? null;
    },
    async createAccount(account) {
      if (accounts.has(account.id)) return false;
      accounts.set(account.id, account);
      return true;
    },
    async getHostAccount(hostHash) {
      return hostAccounts.get(hostHash) ?? null;
    },
    async setHostAccount(hostHash, accountId) {
      hostAccounts.set(hostHash, accountId);
    },
    async putSession(sessionHash, hostHash) {
      sessions.set(sessionHash, hostHash);
    },
    async getSessionHost(sessionHash) {
      return sessions.get(sessionHash) ?? null;
    },
    async deleteSession(sessionHash) {
      sessions.delete(sessionHash);
    },
    async hit(key, windowSeconds) {
      const now = Date.now();
      const entry = hits.get(key);
      if (!entry || entry.until < now) {
        hits.set(key, { count: 1, until: now + windowSeconds * 1000 });
        return 1;
      }
      entry.count += 1;
      return entry.count;
    },
    async setIndexed(event, indexed) {
      if (indexed) index.add(event.id);
      else index.delete(event.id);
    },
    async listIndexed(limit) {
      return [...index]
        .map((id) => events.get(id))
        .filter((e): e is MoimEvent => Boolean(e))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
    },
    async listResponses(id) {
      return [...bucket(id).entries()].map(([name, v]) => ({
        name,
        relation: v.relation ?? "",
        station: v.station ?? "",
        unavailable: v.unavailable,
        updatedAt: v.updatedAt,
      }));
    },
    async countResponses(id) {
      return bucket(id).size;
    },
    async getResponseMeta(id, name) {
      const value = bucket(id).get(name);
      return value
        ? { editHash: value.editHash ?? "", deviceHash: value.deviceHash ?? "" }
        : null;
    },
    async findNameByDevice(id, deviceHash) {
      for (const [name, value] of bucket(id))
        if (value.deviceHash === deviceHash) return name;
      return null;
    },
    async putResponse(id, response, meta) {
      bucket(id).set(response.name, {
        editHash: meta.editHash,
        deviceHash: meta.deviceHash,
        relation: response.relation,
        station: response.station,
        unavailable: response.unavailable,
        updatedAt: response.updatedAt,
      });
    },
    async deleteResponse(id, name) {
      bucket(id).delete(name);
    },
    async getHost(hostHash) {
      return hosts.get(hostHash) ?? null;
    },
    async putHost(hostHash, record) {
      hosts.set(hostHash, record);
    },
    async linkHostEvent(hostHash, eventId, linked) {
      const set = hostEvents.get(hostHash) ?? new Set<string>();
      hostEvents.set(hostHash, set);
      if (linked) set.add(eventId);
      else set.delete(eventId);
    },
    async listHostEvents(hostHash) {
      return [...(hostEvents.get(hostHash) ?? [])]
        .map((id) => events.get(id))
        .filter((e): e is MoimEvent => Boolean(e));
    },
  };
}

let cached: Store | null = null;

export function getStore(): Store {
  if (cached) return cached;
  const credentials = findCredentials();
  if (credentials) {
    cached = redisStore(new Redis(credentials));
    return cached;
  }
  // Vercel에 올렸는데 Redis를 연결하지 않은 경우: 메모리에 저장하면 응답이 조용히 사라지므로 막는다.
  if (process.env.VERCEL) throw new StoreNotConfiguredError();
  cached = memoryStore();
  return cached;
}

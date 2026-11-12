import { Redis } from "@upstash/redis";
import type { MoimEvent, MoimResponse } from "./types";

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
};

interface Store {
  createEvent(event: MoimEvent): Promise<void>;
  getEvent(id: string): Promise<MoimEvent | null>;
  deleteEvent(id: string): Promise<void>;
  listResponses(id: string): Promise<MoimResponse[]>;
  countResponses(id: string): Promise<number>;
  hasResponse(id: string, name: string): Promise<boolean>;
  putResponse(id: string, response: MoimResponse): Promise<void>;
  deleteResponse(id: string, name: string): Promise<void>;
}

const eventKey = (id: string) => `mp:event:${id}`;
const responsesKey = (id: string) => `mp:event:${id}:responses`;

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
    async hasResponse(id, name) {
      return (await redis.hexists(responsesKey(id), name)) === 1;
    },
    async putResponse(id, response) {
      const value: StoredResponse = {
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
  };
}

function memoryStore(): Store {
  const g = globalThis as unknown as {
    __moimEvents?: Map<string, MoimEvent>;
    __moimResponses?: Map<string, Map<string, StoredResponse>>;
  };
  const events = (g.__moimEvents ??= new Map());
  const responses = (g.__moimResponses ??= new Map());
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
    async hasResponse(id, name) {
      return bucket(id).has(name);
    },
    async putResponse(id, response) {
      bucket(id).set(response.name, {
        relation: response.relation,
        station: response.station,
        unavailable: response.unavailable,
        updatedAt: response.updatedAt,
      });
    },
    async deleteResponse(id, name) {
      bucket(id).delete(name);
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

export const ONE_HOUR_TTL = 60 * 60;
export const TEN_MINUTE_TTL = 60 * 10;

export async function getCache(redisClient, key) {
  try {
    const result = await redisClient.get(key);
    return result ? JSON.parse(result) : null;
  } catch (error) {
    console.log("Error getting cache", error);
    return null;
  }
}

export async function setCache(redisClient, key, data, ttl) {
  try {
    const result = await redisClient.set(key, JSON.stringify(data), {
      EX: ttl,
    });
    return result;
  } catch (error) {
    console.log("Error setting cache", error);
    return null;
  }
}

export function getCacheKey(userId, page) {
  return `${page}:${userId}`;
}

export async function invalidateCache(redisClient, key) {
  await redisClient.del(key);
}

export function withNetworkTimeout(promise, timeoutMs = 4000, message = 'The local Yoga server did not respond in time.') {
    let timeout;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
        }),
    ]).finally(() => clearTimeout(timeout));
}

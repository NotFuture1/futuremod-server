import { WhitelistEntry, UsernameEntry } from "./types";

const BIN_ID = process.env.JSONBIN_BIN_ID;
const API_KEY = process.env.JSONBIN_API_KEY;
const BASE_URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`;

const HEADERS = {
    "Content-Type": "application/json",
    "X-Master-Key": API_KEY ?? ""
};

if (!BIN_ID) console.error("[Whitelist] JSONBIN_BIN_ID is not set!");
if (!API_KEY) console.error("[Whitelist] JSONBIN_API_KEY is not set!");
else console.log(`[Whitelist] API key loaded (starts with: ${API_KEY.slice(0, 6)}...)`);


// In-memory cache so we don't hit JSONBin on every operation
let whitelist = new Map<string, WhitelistEntry>();

async function fetchWhitelist(): Promise<void> {
    try {
        const res = await fetch(BASE_URL + "/latest", { headers: HEADERS });
        if (!res.ok) {
            console.error("[Whitelist] Failed to fetch from JSONBin:", res.status, await res.text());
            return;
        }
        const json = await res.json();
        // Support both wrapper format { entries: [] } and legacy bare array []
        const record = json.record;
        let data: WhitelistEntry[] = [];
        if (Array.isArray(record)) {
            data = record;
        } else if (record?.entries && Array.isArray(record.entries)) {
            data = record.entries;
        }

        // Migrate old format if needed: { hwid, username, lastLogin } -> { hwid, usernames: [] }
        const migrated = data.map((e: any) => {
            if (e.usernames) return e;
            return {
                hwid: e.hwid,
                usernames: [{ username: e.username ?? "unknown", lastLogin: e.lastLogin ?? Date.now() }]
            };
        });

        whitelist = new Map(migrated.map((e: WhitelistEntry) => [e.hwid.toLowerCase(), e]));
        console.log(`[Whitelist] Loaded ${whitelist.size} entries from JSONBin`);
    } catch (err) {
        console.error("[Whitelist] Error fetching whitelist:", err);
    }
}

async function saveWhitelist(): Promise<void> {
    try {
        const data = Array.from(whitelist.values());
        // JSONBin doesn't allow empty bins — use a wrapper object
        const body = { entries: data };
        const res = await fetch(BASE_URL, {
            method: "PUT",
            headers: HEADERS,
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            console.error("[Whitelist] Failed to save to JSONBin:", res.status, await res.text());
        }
    } catch (err) {
        console.error("[Whitelist] Error saving whitelist:", err);
    }
}

// Load on startup — export a promise so callers can wait for it
let resolveReady: () => void;
export const whitelistReady: Promise<void> = new Promise(res => { resolveReady = res; });

fetchWhitelist().then(() => resolveReady()).catch(err => {
    console.error("[Whitelist] Startup load failed:", err);
    resolveReady(); // resolve anyway so the server doesn't hang forever
});

export function isWhitelisted(hwid: string): boolean {
    return whitelist.has(hwid.toLowerCase());
}

export async function addToWhitelist(hwid: string, username: string): Promise<boolean> {
    const key = hwid.toLowerCase();
    if (whitelist.has(key)) return false;
    whitelist.set(key, {
        hwid: key,
        usernames: [{ username, lastLogin: Date.now() }]
    });
    await saveWhitelist();
    return true;
}

export async function updateLastLogin(hwid: string, username: string): Promise<void> {
    const key = hwid.toLowerCase();
    const entry = whitelist.get(key);
    if (!entry) return;

    const existing = entry.usernames.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (existing) {
        existing.username = username;
        existing.lastLogin = Date.now();
    } else {
        entry.usernames.push({ username, lastLogin: Date.now() });
    }

    await saveWhitelist();
}

export async function removeFromWhitelist(hwid: string): Promise<boolean> {
    const key = hwid.toLowerCase();
    if (!whitelist.has(key)) return false;
    whitelist.delete(key);
    await saveWhitelist();
    return true;
}

export async function removeByUsername(username: string): Promise<WhitelistEntry | null> {
    const lower = username.toLowerCase();
    for (const [key, entry] of whitelist.entries()) {
        if (entry.usernames.some(u => u.username.toLowerCase() === lower)) {
            whitelist.delete(key);
            await saveWhitelist();
            return entry;
        }
    }
    return null;
}

export function getWhitelist(): WhitelistEntry[] {
    return Array.from(whitelist.values());
}

export function getPrimaryUsername(hwid: string): string | null {
    const entry = whitelist.get(hwid.toLowerCase());
    if (!entry || entry.usernames.length === 0) return null;
    return [...entry.usernames].sort((a, b) => b.lastLogin - a.lastLogin)[0].username;
}

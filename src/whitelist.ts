import fs from "fs";
import path from "path";

const WHITELIST_PATH = path.join(process.cwd(), "whitelist.json");

export interface UsernameEntry {
    username: string;
    lastLogin: number; // unix timestamp ms
}

export interface WhitelistEntry {
    hwid: string;
    usernames: UsernameEntry[];
}

// Map of hwid -> entry
let whitelist = new Map<string, WhitelistEntry>();

function loadWhitelist(): void {
    try {
        if (fs.existsSync(WHITELIST_PATH)) {
            const raw = JSON.parse(fs.readFileSync(WHITELIST_PATH, "utf-8"));
            // Migrate old format: { hwid, username, lastLogin } -> { hwid, usernames: [] }
            const data: WhitelistEntry[] = raw.map((e: any) => {
                if (e.usernames) return e; // already new format
                return {
                    hwid: e.hwid,
                    usernames: [{ username: e.username ?? "unknown", lastLogin: e.lastLogin ?? Date.now() }]
                };
            });
            whitelist = new Map(data.map(e => [e.hwid.toLowerCase(), e]));
            saveWhitelist(); // re-save in new format
        }
    } catch (err) {
        console.error("[Whitelist] Failed to load whitelist:", err);
    }
}

function saveWhitelist(): void {
    try {
        fs.writeFileSync(WHITELIST_PATH, JSON.stringify(Array.from(whitelist.values()), null, 2));
    } catch (err) {
        console.error("[Whitelist] Failed to save whitelist:", err);
    }
}

loadWhitelist();

export function isWhitelisted(hwid: string): boolean {
    return whitelist.has(hwid.toLowerCase());
}

export function addToWhitelist(hwid: string, username: string): boolean {
    const key = hwid.toLowerCase();
    if (whitelist.has(key)) return false;
    whitelist.set(key, {
        hwid: key,
        usernames: [{ username, lastLogin: Date.now() }]
    });
    saveWhitelist();
    return true;
}

export function updateLastLogin(hwid: string, username: string): void {
    const key = hwid.toLowerCase();
    const entry = whitelist.get(key);
    if (!entry) return;

    const existing = entry.usernames.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (existing) {
        // Known username on this HWID — just update last login
        existing.username = username; // preserve latest casing
        existing.lastLogin = Date.now();
    } else {
        // New username on a known HWID — add it
        entry.usernames.push({ username, lastLogin: Date.now() });
    }

    saveWhitelist();
}

export function removeFromWhitelist(hwid: string): boolean {
    const key = hwid.toLowerCase();
    if (!whitelist.has(key)) return false;
    whitelist.delete(key);
    saveWhitelist();
    return true;
}

/** Find and remove an entire HWID branch by any username associated with it */
export function removeByUsername(username: string): WhitelistEntry | null {
    const lower = username.toLowerCase();
    for (const [key, entry] of whitelist.entries()) {
        if (entry.usernames.some(u => u.username.toLowerCase() === lower)) {
            whitelist.delete(key);
            saveWhitelist();
            return entry;
        }
    }
    return null;
}

export function getWhitelist(): WhitelistEntry[] {
    return Array.from(whitelist.values());
}

/** Returns the most recently seen username for a given HWID, or null */
export function getPrimaryUsername(hwid: string): string | null {
    const entry = whitelist.get(hwid.toLowerCase());
    if (!entry || entry.usernames.length === 0) return null;
    return [...entry.usernames].sort((a, b) => b.lastLogin - a.lastLogin)[0].username;
}

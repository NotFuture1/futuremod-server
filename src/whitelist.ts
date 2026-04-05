import fs from "fs";
import path from "path";

const WHITELIST_PATH = path.join(process.cwd(), "whitelist.json");

export interface WhitelistEntry {
    hwid: string;
    username: string;
    lastLogin: number; // unix timestamp ms
}

// Map of hwid -> entry
let whitelist = new Map<string, WhitelistEntry>();

function loadWhitelist(): void {
    try {
        if (fs.existsSync(WHITELIST_PATH)) {
            const data: WhitelistEntry[] = JSON.parse(fs.readFileSync(WHITELIST_PATH, "utf-8"));
            whitelist = new Map(data.map(e => [e.hwid.toLowerCase(), e]));
        }
    } catch (err) {
        console.error("[Whitelist] Failed to load whitelist:", err);
    }
}

function saveWhitelist(): void {
    try {
        const data = Array.from(whitelist.values());
        fs.writeFileSync(WHITELIST_PATH, JSON.stringify(data, null, 2));
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
    whitelist.set(key, { hwid: key, username, lastLogin: Date.now() });
    saveWhitelist();
    return true;
}

export function updateLastLogin(hwid: string, username: string): void {
    const key = hwid.toLowerCase();
    const entry = whitelist.get(key);
    if (entry) {
        entry.username = username; // update username in case they changed it
        entry.lastLogin = Date.now();
        saveWhitelist();
    }
}

export function removeFromWhitelist(hwid: string): boolean {
    const key = hwid.toLowerCase();
    if (!whitelist.has(key)) return false;
    whitelist.delete(key);
    saveWhitelist();
    return true;
}

export function getWhitelist(): WhitelistEntry[] {
    return Array.from(whitelist.values());
}

import fs from "fs";
import path from "path";

const WHITELIST_PATH = path.join(process.cwd(), "whitelist.json");

function loadWhitelist(): Set<string> {
    try {
        if (fs.existsSync(WHITELIST_PATH)) {
            const data = JSON.parse(fs.readFileSync(WHITELIST_PATH, "utf-8"));
            return new Set<string>(data.map((u: string) => u.toLowerCase()));
        }
    } catch (err) {
        console.error("[Whitelist] Failed to load whitelist:", err);
    }
    return new Set();
}

function saveWhitelist(whitelist: Set<string>): void {
    try {
        fs.writeFileSync(WHITELIST_PATH, JSON.stringify(Array.from(whitelist), null, 2));
    } catch (err) {
        console.error("[Whitelist] Failed to save whitelist:", err);
    }
}

let whitelist = loadWhitelist();

export function isWhitelisted(username: string): boolean {
    return whitelist.has(username.toLowerCase());
}

export function addToWhitelist(username: string): boolean {
    const key = username.toLowerCase();
    if (whitelist.has(key)) return false;
    whitelist.add(key);
    saveWhitelist(whitelist);
    return true;
}

export function removeFromWhitelist(username: string): boolean {
    const key = username.toLowerCase();
    if (!whitelist.has(key)) return false;
    whitelist.delete(key);
    saveWhitelist(whitelist);
    return true;
}

export function getWhitelist(): string[] {
    return Array.from(whitelist);
}

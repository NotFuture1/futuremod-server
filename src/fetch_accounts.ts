import { ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { WhitelistEntry } from "./types";

const TIMEOUT_MS = 15_000; // 15 seconds to wait for mod response

interface PendingRequest {
    interaction: ChatInputCommandInteraction;
    knownEntry: WhitelistEntry;
    timer: NodeJS.Timeout;
    resolve: (accounts: string[]) => void;
}

// requestId -> pending request
export const pendingRequests = new Map<string, PendingRequest>();

export function generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildAccountsEmbed(
    entry: WhitelistEntry,
    extraAccounts: string[] | null,
    timedOut: boolean
): EmbedBuilder {
    const knownNames = entry.usernames
        .sort((a, b) => b.lastLogin - a.lastLogin)
        .map(u => `• **${u.username}** — last seen: ${new Date(u.lastLogin).toUTCString()}`);

    const embed = new EmbedBuilder()
        .setTitle("🔍 Account Lookup")
        .setColor(0x5865F2)
        .setTimestamp()
        .addFields({
            name: `📋 Known Accounts (${knownNames.length})`,
            value: knownNames.join("\n") || "None",
            inline: false
        });

    if (extraAccounts !== null) {
        const newAccounts = extraAccounts.filter(
            a => !entry.usernames.some(u => u.username.toLowerCase() === a.toLowerCase())
        );
        embed.addFields({
            name: `🔎 Additional Accounts Found (${newAccounts.length})`,
            value: newAccounts.length > 0 ? newAccounts.map(a => `• **${a}**`).join("\n") : "None found",
            inline: false
        });
    } else if (timedOut) {
        embed.addFields({
            name: "🔎 Additional Accounts",
            value: "⏱️ Mod scan timed out — no online clients responded.",
            inline: false
        });
    } else {
        embed.addFields({
            name: "🔎 Additional Accounts",
            value: "⏳ Scanning via mod...",
            inline: false
        });
    }

    embed.setFooter({ text: `HWID: ${entry.hwid.slice(0, 16)}...` });
    return embed;
}

export function registerPendingRequest(
    requestId: string,
    interaction: ChatInputCommandInteraction,
    knownEntry: WhitelistEntry
): void {
    const timer = setTimeout(async () => {
        // Timed out — edit the reply with whatever we have
        if (pendingRequests.has(requestId)) {
            pendingRequests.delete(requestId);
            try {
                await interaction.editReply({
                    embeds: [buildAccountsEmbed(knownEntry, null, true)]
                });
            } catch (err) {
                console.error("[FetchAccounts] Failed to edit reply on timeout:", err);
            }
        }
    }, TIMEOUT_MS);

    pendingRequests.set(requestId, {
        interaction,
        knownEntry,
        timer,
        resolve: () => {}
    });
}

export async function resolveRequest(requestId: string, accounts: string[]): Promise<void> {
    const pending = pendingRequests.get(requestId);
    if (!pending) return;

    clearTimeout(pending.timer);
    pendingRequests.delete(requestId);

    try {
        await pending.interaction.editReply({
            embeds: [buildAccountsEmbed(pending.knownEntry, accounts, false)]
        });
    } catch (err) {
        console.error("[FetchAccounts] Failed to edit reply with results:", err);
    }
}

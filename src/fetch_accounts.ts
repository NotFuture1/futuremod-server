import { ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ButtonInteraction } from "discord.js";
import { WhitelistEntry } from "./types";

const TIMEOUT_MS = 15_000;
const PAGE_SIZE = 10;

interface PendingRequest {
    interaction: ChatInputCommandInteraction;
    knownEntry: WhitelistEntry;
    timer: NodeJS.Timeout;
}

// requestId -> pending request
export const pendingRequests = new Map<string, PendingRequest>();

// messageId -> paginator state (for button interactions)
interface PaginatorState {
    knownEntry: WhitelistEntry;
    extraAccounts: string[];
    page: number;
    totalPages: number;
}
export const paginators = new Map<string, PaginatorState>();

export function generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normaliseAccounts(raw: any[]): string[] {
    return raw.map(a => typeof a === "string" ? a : `${a.name} (${a.uuid})`);
}

function buildPage(entry: WhitelistEntry, extraAccounts: string[], page: number): {
    embeds: [EmbedBuilder];
    components: [ActionRowBuilder<ButtonBuilder>];
} {
    const knownNames = entry.usernames
        .sort((a, b) => b.lastLogin - a.lastLogin)
        .map(u => `• **${u.username}** — last seen: ${new Date(u.lastLogin).toUTCString()}`);

    const newAccounts = extraAccounts.filter(a => {
        const name = a.includes(" (") ? a.split(" (")[0] : a;
        return !entry.usernames.some(u => u.username.toLowerCase() === name.toLowerCase());
    });

    const totalPages = Math.max(1, Math.ceil(newAccounts.length / PAGE_SIZE));
    const pageAccounts = newAccounts.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    const embed = new EmbedBuilder()
        .setTitle("🔍 Account Lookup")
        .setColor(0x5865F2)
        .setTimestamp()
        .addFields({
            name: `📋 Known Accounts (${knownNames.length})`,
            value: knownNames.join("\n") || "None",
            inline: false
        })
        .addFields({
            name: `🔎 Additional Accounts (${newAccounts.length}) — Page ${page + 1}/${totalPages}`,
            value: pageAccounts.length > 0
                ? pageAccounts.map(a => `• **${a}**`).join("\n")
                : "None found",
            inline: false
        })
        .setFooter({ text: `HWID: ${entry.hwid.slice(0, 16)}...` });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`accounts_prev:${page}`)
            .setEmoji("⬅️")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
        new ButtonBuilder()
            .setCustomId(`accounts_next:${page}`)
            .setEmoji("➡️")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= totalPages - 1)
    );

    return { embeds: [embed], components: [row] };
}

export function buildScanningEmbed(entry: WhitelistEntry): {
    embeds: [EmbedBuilder];
} {
    const knownNames = entry.usernames
        .sort((a, b) => b.lastLogin - a.lastLogin)
        .map(u => `• **${u.username}** — last seen: ${new Date(u.lastLogin).toUTCString()}`);

    const embed = new EmbedBuilder()
        .setTitle("🔍 Account Lookup")
        .setColor(0x5865F2)
        .setTimestamp()
        .addFields(
            { name: `📋 Known Accounts (${knownNames.length})`, value: knownNames.join("\n") || "None", inline: false },
            { name: "🔎 Additional Accounts", value: "⏳ Scanning via mod...", inline: false }
        )
        .setFooter({ text: `HWID: ${entry.hwid.slice(0, 16)}...` });

    return { embeds: [embed] };
}

export function buildTimedOutEmbed(entry: WhitelistEntry): {
    embeds: [EmbedBuilder];
} {
    const knownNames = entry.usernames
        .sort((a, b) => b.lastLogin - a.lastLogin)
        .map(u => `• **${u.username}** — last seen: ${new Date(u.lastLogin).toUTCString()}`);

    const embed = new EmbedBuilder()
        .setTitle("🔍 Account Lookup")
        .setColor(0x5865F2)
        .setTimestamp()
        .addFields(
            { name: `📋 Known Accounts (${knownNames.length})`, value: knownNames.join("\n") || "None", inline: false },
            { name: "🔎 Additional Accounts", value: "⏱️ Mod scan timed out — no online clients responded.", inline: false }
        )
        .setFooter({ text: `HWID: ${entry.hwid.slice(0, 16)}...` });

    return { embeds: [embed] };
}

export function registerPendingRequest(
    requestId: string,
    interaction: ChatInputCommandInteraction,
    knownEntry: WhitelistEntry
): void {
    const timer = setTimeout(async () => {
        if (pendingRequests.has(requestId)) {
            pendingRequests.delete(requestId);
            try {
                await interaction.editReply(buildTimedOutEmbed(knownEntry));
            } catch (err) {
                console.error("[FetchAccounts] Failed to edit reply on timeout:", err);
            }
        }
    }, TIMEOUT_MS);

    pendingRequests.set(requestId, { interaction, knownEntry, timer });
}

export async function resolveRequest(requestId: string, rawAccounts: any[]): Promise<void> {
    const pending = pendingRequests.get(requestId);
    if (!pending) return;

    clearTimeout(pending.timer);
    pendingRequests.delete(requestId);

    const accounts = normaliseAccounts(rawAccounts);

    try {
        const pageData = buildPage(pending.knownEntry, accounts, 0);
        const reply = await pending.interaction.editReply(pageData);

        // Register paginator keyed by the reply message ID
        const newAccounts = accounts.filter(a => {
            const name = a.includes(" (") ? a.split(" (")[0] : a;
            return !pending.knownEntry.usernames.some(u => u.username.toLowerCase() === name.toLowerCase());
        });
        const totalPages = Math.max(1, Math.ceil(newAccounts.length / PAGE_SIZE));

        paginators.set(reply.id, {
            knownEntry: pending.knownEntry,
            extraAccounts: accounts,
            page: 0,
            totalPages
        });

        // Clean up paginator after 10 minutes
        setTimeout(() => paginators.delete(reply.id), 600_000);
    } catch (err) {
        console.error("[FetchAccounts] Failed to edit reply with results:", err);
    }
}

export async function handlePaginatorButton(interaction: ButtonInteraction): Promise<void> {
    const state = paginators.get(interaction.message.id);
    if (!state) {
        await interaction.deferUpdate();
        return;
    }

    await interaction.deferUpdate();

    const [action, currentPage] = interaction.customId.split(":");
    let newPage = parseInt(currentPage);

    if (action === "accounts_prev") newPage = Math.max(0, newPage - 1);
    if (action === "accounts_next") newPage = Math.min(state.totalPages - 1, newPage + 1);

    state.page = newPage;

    const pageData = buildPage(state.knownEntry, state.extraAccounts, newPage);
    await interaction.editReply(pageData);
}

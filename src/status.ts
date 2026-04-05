import { Client, EmbedBuilder, TextChannel, Message } from "discord.js";
import { getOnlineUsernames } from "./state";

const STATUS_CHANNEL_ID = "1490290413163249834";
const UPDATE_INTERVAL_MS = 30_000; // 30 seconds

let statusMessage: Message | null = null;

function buildStatusEmbed(): { embeds: [EmbedBuilder] } {
    const users = getOnlineUsernames();
    const embed = new EmbedBuilder()
        .setTitle("📡 FutureMod — Live Status")
        .setColor(users.length > 0 ? 0x00FF00 : 0x888888)
        .setTimestamp()
        .setFooter({ text: `Updates every 30s • Last updated` });

    if (users.length === 0) {
        embed.setDescription("🔴 No users currently online.");
    } else {
        embed.setDescription(users.map(u => `🟢 **${u}**`).join("\n"));
        embed.setFooter({ text: `${users.length} user(s) online • Last updated` });
    }

    return { embeds: [embed] };
}

async function updateStatus(client: Client): Promise<void> {
    try {
        const channel = await client.channels.fetch(STATUS_CHANNEL_ID) as TextChannel;
        if (!channel || !channel.isTextBased()) return;

        if (statusMessage) {
            // Edit the existing message
            await statusMessage.edit(buildStatusEmbed());
        } else {
            // Look for an existing bot message to reuse (survives restarts)
            const recent = await channel.messages.fetch({ limit: 10 });
            const existing = recent.find(m => m.author.id === client.user?.id);

            if (existing) {
                statusMessage = existing;
                await statusMessage.edit(buildStatusEmbed());
            } else {
                // Post a fresh one
                statusMessage = await channel.send(buildStatusEmbed());
            }
        }
    } catch (err) {
        console.error("[Status] Failed to update status message:", err);
        statusMessage = null; // Reset so we try to find/create again next tick
    }
}

export function startStatusUpdater(client: Client): void {
    // Wait for bot to be ready before first update
    client.once("clientReady", async () => {
        await updateStatus(client);
        setInterval(() => updateStatus(client), UPDATE_INTERVAL_MS);
    });
}

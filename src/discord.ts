import { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ButtonInteraction, TextChannel } from "discord.js";
import { getUser, removeUser } from "./state";
import { ServerMessage } from "./types";

const bot = new Client({ intents: [GatewayIntentBits.Guilds] });

let botReady = false;

// Queue entries waiting for the bot to be ready
const pendingQueue: Array<{ username: string; uuid: string }> = [];

bot.once("clientReady", () => {
    botReady = true;
    console.log(`[Discord] Bot ready as ${bot.user?.tag}`);
    console.log(`[Discord] Serving ${bot.guilds.cache.size} guild(s)`);
    // Flush anything that arrived before the bot was ready
    for (const entry of pendingQueue) {
        sendApprovalRequest(entry.username, entry.uuid).catch(console.error);
    }
    pendingQueue.length = 0;
});

bot.on("error", (err) => {
    console.error("[Discord] Client error:", err);
});

process.on("unhandledRejection", (err) => {
    console.error("[Discord] Unhandled rejection:", err);
});

// Map of pendingKey -> Discord message ID, so we can edit the embed after action
const pendingMessages = new Map<string, string>();

export function pendingKey(username: string, uuid: string): string {
    return `${username.toLowerCase()}:${uuid}`;
}

export async function sendApprovalRequest(username: string, uuid: string): Promise<void> {
    if (!botReady) {
        console.warn(`[Discord] Bot not ready — queuing approval for ${username}`);
        pendingQueue.push({ username, uuid });
        return;
    }

    const channelId = process.env.DISCORD_CHANNEL_ID;
    if (!channelId) {
        console.error("[Discord] DISCORD_CHANNEL_ID not set");
        return;
    }

    try {
        const channel = await bot.channels.fetch(channelId) as TextChannel;
        if (!channel || !channel.isTextBased()) {
            console.error("[Discord] Channel not found or not text-based");
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle("🔐 New Login Request")
            .setColor(0xFFA500)
            .addFields(
                { name: "Username", value: username, inline: true },
                { name: "UUID", value: uuid, inline: true },
                { name: "Status", value: "⏳ Pending", inline: false }
            )
            .setTimestamp();

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`approve:${username}:${uuid}`)
                .setLabel("Approve")
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`decline:${username}:${uuid}`)
                .setLabel("Decline")
                .setStyle(ButtonStyle.Danger)
        );

        const sent = await channel.send({ embeds: [embed], components: [row] });
        pendingMessages.set(pendingKey(username, uuid), sent.id);
        console.log(`[Discord] Sent approval request for ${username}`);
    } catch (err) {
        console.error("[Discord] Failed to send approval request:", err);
    }
}

// Update the embed after approve/decline so buttons can't be clicked twice
async function resolveEmbed(interaction: ButtonInteraction, username: string, approved: boolean): Promise<void> {
    const embed = new EmbedBuilder()
        .setTitle("🔐 Login Request")
        .setColor(approved ? 0x00FF00 : 0xFF0000)
        .addFields(
            { name: "Username", value: username, inline: true },
            { name: "Status", value: approved ? "✅ Approved" : "❌ Declined", inline: false },
            { name: "Actioned by", value: interaction.user.tag, inline: false }
        )
        .setTimestamp();

    await interaction.update({ embeds: [embed], components: [] });
}

bot.on("interactionCreate", async (interaction) => {
    if (!interaction.isButton()) return;

    const [action, username, uuid] = interaction.customId.split(":");
    if (!action || !username || !uuid) return;

    const user = getUser(username);

    if (!user) {
        // User already disconnected
        const embed = new EmbedBuilder()
            .setTitle("🔐 Login Request")
            .setColor(0x888888)
            .addFields(
                { name: "Username", value: username, inline: true },
                { name: "Status", value: "⚠️ User already disconnected", inline: false }
            )
            .setTimestamp();
        await interaction.update({ embeds: [embed], components: [] });
        return;
    }

    if (action === "approve") {
        user.approved = true;

        const approvedMsg: ServerMessage = { type: "approved" };
        user.socket.send(JSON.stringify(approvedMsg));

        // Now send them the online users list
        const { getOnlineUsernames } = await import("./state");
        const onlineMsg: ServerMessage = {
            type: "online_users",
            success: true,
            onlineUsers: getOnlineUsernames()
        };
        user.socket.send(JSON.stringify(onlineMsg));

        console.log(`[Discord] Approved ${username}`);
        await resolveEmbed(interaction, username, true);

    } else if (action === "decline") {
        const kickMsg: ServerMessage = {
            type: "kick",
            reason: "Access denied by server owner."
        };
        user.socket.send(JSON.stringify(kickMsg));
        user.socket.close();
        removeUser(username);

        console.log(`[Discord] Declined ${username}`);
        await resolveEmbed(interaction, username, false);
    }

    pendingMessages.delete(pendingKey(username, uuid));
});

export function startDiscordBot(): void {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
        console.error("[Discord] DISCORD_BOT_TOKEN not set — bot will not start");
        return;
    }
    bot.login(token);
}

import { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ButtonInteraction, TextChannel, ChatInputCommandInteraction } from "discord.js";
import { getUser, removeUser, getOnlineUsernames } from "./state";
import { ServerMessage } from "./types";
import { addToWhitelist } from "./whitelist";
import { registerCommands, handleCommand } from "./commands";

const bot = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

let botReady = false;

// Queue entries waiting for the bot to be ready
const pendingQueue: Array<{ username: string; uuid: string; hwid: string }> = [];

bot.once("clientReady", () => {
    botReady = true;
    console.log(`[Discord] Bot ready as ${bot.user?.tag}`);
    console.log(`[Discord] Serving ${bot.guilds.cache.size} guild(s)`);
    registerCommands(bot).catch(console.error);
    for (const entry of pendingQueue) {
        sendApprovalRequest(entry.username, entry.uuid, entry.hwid).catch(console.error);
    }
    pendingQueue.length = 0;
});

bot.on("error", (err) => {
    console.error("[Discord] Client error:", err);
});

process.on("unhandledRejection", (err) => {
    console.error("[Discord] Unhandled rejection:", err);
});

// Keyed by hwid
const pendingMessages = new Map<string, string>();

export async function sendApprovalRequest(username: string, uuid: string, hwid: string): Promise<void> {
    if (!botReady) {
        console.warn(`[Discord] Bot not ready — queuing approval for ${username}`);
        pendingQueue.push({ username, uuid, hwid });
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
            .setThumbnail(`https://mc-heads.net/avatar/${uuid}/128`)
            .addFields(
                { name: "Username", value: username, inline: true },
                { name: "HWID", value: `\`${hwid.slice(0, 16)}...\``, inline: true },
                { name: "Status", value: "⏳ Pending", inline: false }
            )
            .setTimestamp();

        // Three buttons: Approve (one-time), Whitelist HWID (approve + remember), Decline
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`approve:${username}:${hwid}`)
                .setLabel("Approve")
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`whitelist:${username}:${hwid}`)
                .setLabel("Approve & Whitelist HWID")
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`decline:${username}:${hwid}`)
                .setLabel("Decline")
                .setStyle(ButtonStyle.Danger)
        );

        const sent = await channel.send({ embeds: [embed], components: [row] });
        pendingMessages.set(hwid, sent.id);
        console.log(`[Discord] Sent approval request for ${username} (HWID: ${hwid.slice(0, 16)}...)`);
    } catch (err) {
        console.error("[Discord] Failed to send approval request:", err);
    }
}

async function resolveEmbed(
    interaction: ButtonInteraction,
    username: string,
    status: "approved" | "whitelisted" | "declined"
): Promise<void> {
    const colorMap = { approved: 0x00FF00, whitelisted: 0x5865F2, declined: 0xFF0000 };
    const labelMap = {
        approved: "✅ Approved",
        whitelisted: "✅ Approved & HWID Whitelisted",
        declined: "❌ Declined"
    };

    const embed = new EmbedBuilder()
        .setTitle("🔐 Login Request")
        .setColor(colorMap[status])
        .addFields(
            { name: "Username", value: username, inline: true },
            { name: "Status", value: labelMap[status], inline: false },
            { name: "Actioned by", value: interaction.user.tag, inline: false }
        )
        .setTimestamp();

    await interaction.update({ embeds: [embed], components: [] });
}

function approveUser(username: string): void {
    const user = getUser(username);
    if (!user) return;
    user.approved = true;
    const approvedMsg: ServerMessage = { type: "approved" };
    user.socket.send(JSON.stringify(approvedMsg));
    user.socket.send(JSON.stringify({
        type: "online_users",
        success: true,
        onlineUsers: getOnlineUsernames()
    }));
}

bot.on("interactionCreate", async (interaction) => {
    if (interaction.isChatInputCommand()) {
        await handleCommand(interaction as ChatInputCommandInteraction);
        return;
    }

    if (!interaction.isButton()) return;

    const parts = interaction.customId.split(":");
    const action = parts[0];
    const username = parts[1];
    const hwid = parts[2];

    if (!action || !username || !hwid) return;

    const user = getUser(username);

    if (!user) {
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
        approveUser(username);
        console.log(`[Discord] Approved ${username} (one-time)`);
        await resolveEmbed(interaction, username, "approved");

    } else if (action === "whitelist") {
        addToWhitelist(hwid);
        approveUser(username);
        console.log(`[Discord] Approved & whitelisted HWID for ${username}`);
        await resolveEmbed(interaction, username, "whitelisted");

    } else if (action === "decline") {
        const kickMsg: ServerMessage = {
            type: "kick",
            reason: "Access denied by server owner."
        };
        user.socket.send(JSON.stringify(kickMsg));
        user.socket.close();
        removeUser(username);
        console.log(`[Discord] Declined ${username}`);
        await resolveEmbed(interaction, username, "declined");
    }

    pendingMessages.delete(hwid);
});

export function startDiscordBot(): void {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
        console.error("[Discord] DISCORD_BOT_TOKEN not set — bot will not start");
        return;
    }
    bot.login(token);
}

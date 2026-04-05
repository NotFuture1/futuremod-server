import {
    Client,
    REST,
    Routes,
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    EmbedBuilder
} from "discord.js";
import { getOnlineUsernames, getUser, connectedUsers } from "./state";
import { addToWhitelist, removeFromWhitelist, getWhitelist } from "./whitelist";
import { ServerMessage } from "./types";

const commands = [
    new SlashCommandBuilder()
        .setName("online")
        .setDescription("See all currently online FutureMod users"),

    new SlashCommandBuilder()
        .setName("whitelist")
        .setDescription("Manage the FutureMod whitelist")
        .addSubcommand(sub =>
            sub.setName("list")
                .setDescription("See all whitelisted users")
        )
        .addSubcommand(sub =>
            sub.setName("add")
                .setDescription("Add a user to the whitelist")
                .addStringOption(opt =>
                    opt.setName("username")
                        .setDescription("Minecraft username to whitelist")
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName("remove")
                .setDescription("Remove a user from the whitelist")
                .addStringOption(opt =>
                    opt.setName("username")
                        .setDescription("Minecraft username to remove")
                        .setRequired(true)
                )
        ),

    new SlashCommandBuilder()
        .setName("message")
        .setDescription("Send a message to a connected FutureMod user")
        .addStringOption(opt =>
            opt.setName("user")
                .setDescription("Username to send to, or 'all' for everyone")
                .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName("text")
                .setDescription("The message to send")
                .setRequired(true)
        ),
].map(cmd => cmd.toJSON());

export async function registerCommands(client: Client): Promise<void> {
    const token = process.env.DISCORD_BOT_TOKEN;
    const clientId = client.user?.id;

    if (!token || !clientId) {
        console.error("[Commands] Missing token or client ID — cannot register commands");
        return;
    }

    try {
        const rest = new REST({ version: "10" }).setToken(token);
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
        console.log(`[Commands] Registered ${commands.length} slash commands`);
    } catch (err) {
        console.error("[Commands] Failed to register commands:", err);
    }
}

const ALLOWED_ROLE_ID = "1400002372863918091";

export async function handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const { commandName } = interaction;

    // Check that the user has the required role
    const member = interaction.guild?.members.cache.get(interaction.user.id)
        ?? await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);

    if (!member || !member.roles.cache.has(ALLOWED_ROLE_ID)) {
        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setDescription("❌ You don't have permission to use FutureMod commands.")
                    .setTimestamp()
            ],
            ephemeral: true
        });
        return;
    }

    // /online
    if (commandName === "online") {
        const users = getOnlineUsernames();

        const embed = new EmbedBuilder()
            .setTitle("🟢 Online Users")
            .setColor(0x00FF00)
            .setTimestamp();

        if (users.length === 0) {
            embed.setDescription("No users currently online.");
        } else {
            embed.setDescription(users.map(u => `• ${u}`).join("\n"));
            embed.setFooter({ text: `${users.length} user(s) online` });
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
    }

    // /whitelist
    if (commandName === "whitelist") {
        const sub = interaction.options.getSubcommand();

        if (sub === "list") {
            const list = getWhitelist();
            const embed = new EmbedBuilder()
                .setTitle("📋 Whitelist")
                .setColor(0x5865F2)
                .setTimestamp();

            if (list.length === 0) {
                embed.setDescription("The whitelist is empty.");
            } else {
                embed.setDescription(list.map(u => `• ${u}`).join("\n"));
                embed.setFooter({ text: `${list.length} user(s) whitelisted` });
            }

            await interaction.reply({ embeds: [embed], ephemeral: true });
            return;
        }

        if (sub === "add") {
            const input = interaction.options.getString("username", true);

            // Allow passing a username — look up their HWID if they're online
            const connectedUser = getUser(input);
            const hwid = connectedUser ? connectedUser.hwid : input;

            const added = addToWhitelist(hwid);
            const display = connectedUser ? `${input} (HWID: \`${hwid.slice(0, 16)}...\`)` : `\`${hwid.slice(0, 16)}...\``;

            const embed = new EmbedBuilder()
                .setColor(added ? 0x00FF00 : 0xFFA500)
                .setDescription(
                    added
                        ? `✅ Added ${display} to the whitelist.`
                        : `⚠️ ${display} is already on the whitelist.`
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embed], ephemeral: true });
            return;
        }

        if (sub === "remove") {
            const input = interaction.options.getString("username", true);

            // Allow passing a username — look up their HWID if they're online
            const connectedUser = getUser(input);
            const hwid = connectedUser ? connectedUser.hwid : input;

            const removed = removeFromWhitelist(hwid);

            // If they're currently online, kick them
            if (removed && connectedUser) {
                const kickMsg: ServerMessage = {
                    type: "kick",
                    reason: "You have been removed from the whitelist."
                };
                connectedUser.socket.send(JSON.stringify(kickMsg));
                connectedUser.socket.close();
            }

            const display = connectedUser ? `${input} (HWID: \`${hwid.slice(0, 16)}...\`)` : `\`${hwid.slice(0, 16)}...\``;

            const embed = new EmbedBuilder()
                .setColor(removed ? 0xFF0000 : 0xFFA500)
                .setDescription(
                    removed
                        ? `🗑️ Removed ${display} from the whitelist.`
                        : `⚠️ ${display} was not on the whitelist.`
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embed], ephemeral: true });
            return;
        }
    }

    // /message
    if (commandName === "message") {
        const target = interaction.options.getString("user", true);
        const text = interaction.options.getString("text", true);

        const msgPayload: ServerMessage = {
            type: "server_message",
            message: text
        };

        if (target.toLowerCase() === "all") {
            let count = 0;
            for (const user of connectedUsers.values()) {
                if (user.approved) {
                    user.socket.send(JSON.stringify(msgPayload));
                    count++;
                }
            }

            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setDescription(`📢 Message sent to **${count}** online user(s).\n> ${text}`)
                .setTimestamp();

            await interaction.reply({ embeds: [embed], ephemeral: true });
            return;
        }

        const user = getUser(target);
        if (!user || !user.approved) {
            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setDescription(`❌ **${target}** is not online.`)
                .setTimestamp();

            await interaction.reply({ embeds: [embed], ephemeral: true });
            return;
        }

        user.socket.send(JSON.stringify(msgPayload));

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setDescription(`📨 Message sent to **${target}**.\n> ${text}`)
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
    }
}

import {
    Client,
    REST,
    Routes,
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    EmbedBuilder,
    TextChannel
} from "discord.js";
import { getOnlineUsernames, getUser, connectedUsers } from "./state";
import { addToWhitelist, removeFromWhitelist, removeByUsername, getWhitelist } from "./whitelist";
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
                .setDescription("Add a user to the whitelist (pass username if they're online)")
                .addStringOption(opt =>
                    opt.setName("username")
                        .setDescription("Minecraft username (if online) or raw HWID")
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName("remove")
                .setDescription("Remove a user from the whitelist")
                .addStringOption(opt =>
                    opt.setName("username")
                        .setDescription("Minecraft username (if online) or raw HWID")
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

    new SlashCommandBuilder()
        .setName("clear")
        .setDescription("Delete all non-bot messages in this channel"),

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
                const lines = list.map(e => {
                    const hwidShort = `\`${e.hwid.slice(0, 16)}...\``;
                    const userLines = e.usernames
                        .sort((a, b) => b.lastLogin - a.lastLogin)
                        .map(u => `  • **${u.username}** — last login: ${new Date(u.lastLogin).toUTCString()}`)
                        .join("\n");
                    return `🔑 ${hwidShort}\n${userLines}`;
                });
                embed.setDescription(lines.join("\n\n"));
                embed.setFooter({ text: `${list.length} HWID(s) whitelisted` });
            }

            await interaction.reply({ embeds: [embed], ephemeral: true });
            return;
        }

        if (sub === "add") {
            const input = interaction.options.getString("username", true);

            // If they're online, look up their HWID and username automatically
            const connectedUser = getUser(input);
            const hwid = connectedUser ? connectedUser.hwid : input;
            const username = connectedUser ? connectedUser.username : input;

            const added = addToWhitelist(hwid, username);
            const display = connectedUser
                ? `**${username}** (\`${hwid.slice(0, 16)}...\`)`
                : `\`${hwid.slice(0, 16)}...\``;

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

            // Try to find and remove the entire HWID branch by username
            const removed = removeByUsername(input);

            if (removed) {
                // Kick anyone from that HWID branch who is currently online
                for (const u of removed.usernames) {
                    const onlineUser = getUser(u.username);
                    if (onlineUser) {
                        onlineUser.socket.send(JSON.stringify({
                            type: "kick",
                            reason: "You have been removed from the whitelist."
                        }));
                        onlineUser.socket.close();
                    }
                }

                const allNames = removed.usernames.map(u => `**${u.username}**`).join(", ");
                const embed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setDescription(`🗑️ Removed HWID \`${removed.hwid.slice(0, 16)}...\` and all associated accounts: ${allNames}`)
                    .setTimestamp();
                await interaction.reply({ embeds: [embed], ephemeral: true });
            } else {
                const embed = new EmbedBuilder()
                    .setColor(0xFFA500)
                    .setDescription(`⚠️ No whitelisted HWID found for username **${input}**.`)
                    .setTimestamp();
                await interaction.reply({ embeds: [embed], ephemeral: true });
            }
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

    // /clear
    if (commandName === "clear") {
        const channel = interaction.channel as TextChannel;
        if (!channel) return;

        // Defer since bulk fetching/deleting can take a moment
        await interaction.deferReply({ ephemeral: true });

        let deleted = 0;

        // Fetch up to 100 messages at a time and delete non-bot ones
        // Discord only allows bulk delete for messages under 14 days old
        let lastId: string | undefined;
        while (true) {
            const messages = await channel.messages.fetch({ limit: 100, ...(lastId ? { before: lastId } : {}) });
            if (messages.size === 0) break;

            const toDelete = messages.filter(m => !m.author.bot);
            if (toDelete.size > 0) {
                await channel.bulkDelete(toDelete, true); // true = skip messages older than 14 days
                deleted += toDelete.size;
            }

            // If all remaining messages are from the bot, we're done
            if (toDelete.size === 0) break;
            lastId = messages.last()?.id;
        }

        await interaction.editReply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0x00FF00)
                    .setDescription(`🧹 Deleted **${deleted}** non-bot message(s).`)
                    .setTimestamp()
            ]
        });
        return;
    }
}

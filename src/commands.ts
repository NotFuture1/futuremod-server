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
import { generateRequestId, registerPendingRequest, buildAccountsEmbed } from "./fetch_accounts";

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

    new SlashCommandBuilder()
        .setName("convert")
        .setDescription("Convert an old username-array JSON to the new UUID:username format")
        .addAttachmentOption(opt =>
            opt.setName("file")
                .setDescription("The old JSON file (array of usernames)")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("fetch_accounts")
        .setDescription("Look up all known and discoverable accounts for a user")
        .addStringOption(opt =>
            opt.setName("target")
                .setDescription("Minecraft username or HWID")
                .setRequired(true)
        ),

].map(cmd => cmd.toJSON());

export async function registerCommands(client: Client): Promise<void> {
    const token = process.env.DISCORD_BOT_TOKEN;
    const clientId = client.user?.id;
    const guildId = process.env.DISCORD_GUILD_ID;

    if (!token || !clientId) {
        console.error("[Commands] Missing token or client ID — cannot register commands");
        return;
    }

    try {
        const rest = new REST({ version: "10" }).setToken(token);

        if (guildId) {
            // Guild-specific registration — instant, no caching delay
            // Also clear any old global commands to avoid duplicates
            await rest.put(Routes.applicationCommands(clientId), { body: [] });
            await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
            console.log(`[Commands] Registered ${commands.length} slash commands (guild-specific, instant)`);
        } else {
            // Global registration — takes up to 1 hour to propagate
            await rest.put(Routes.applicationCommands(clientId), { body: commands });
            console.log(`[Commands] Registered ${commands.length} slash commands (global)`);
        }
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

    // Defer immediately so Discord doesn't time out while we do async work
    await interaction.deferReply({ ephemeral: true });

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

        await interaction.editReply({ embeds: [embed] });
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

            await interaction.editReply({ embeds: [embed] });
            return;
        }

        if (sub === "add") {
            const input = interaction.options.getString("username", true);

            const connectedUser = getUser(input);
            const hwid = connectedUser ? connectedUser.hwid : input;
            const username = connectedUser ? connectedUser.username : input;

            const added = await addToWhitelist(hwid, username);
            const display = connectedUser
                ? `**${username}** (\`${hwid.slice(0, 16)}...\`)`
                : `\`${hwid.slice(0, 16)}...\``;

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor(added ? 0x00FF00 : 0xFFA500)
                    .setDescription(added
                        ? `✅ Added ${display} to the whitelist.`
                        : `⚠️ ${display} is already on the whitelist.`)
                    .setTimestamp()]
            });
            return;
        }

        if (sub === "remove") {
            const input = interaction.options.getString("username", true);

            const removed = await removeByUsername(input);

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
                await interaction.editReply({ embeds: [embed] });
            } else {
                const embed = new EmbedBuilder()
                    .setColor(0xFFA500)
                    .setDescription(`⚠️ No whitelisted HWID found for username **${input}**.`)
                    .setTimestamp();
                await interaction.editReply({ embeds: [embed] });
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

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setDescription(`📢 Message sent to **${count}** online user(s).\n> ${text}`)
                    .setTimestamp()]
            });
            return;
        }

        const user = getUser(target);
        if (!user || !user.approved) {
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setDescription(`❌ **${target}** is not online.`)
                    .setTimestamp()]
            });
            return;
        }

        user.socket.send(JSON.stringify(msgPayload));

        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor(0x5865F2)
                .setDescription(`📨 Message sent to **${target}**.\n> ${text}`)
                .setTimestamp()]
        });
        return;
    }

    // /clear
    if (commandName === "clear") {
        const channel = interaction.channel as TextChannel;
        if (!channel) return;

        let deleted = 0;
        let lastId: string | undefined;
        while (true) {
            const messages = await channel.messages.fetch({ limit: 100, ...(lastId ? { before: lastId } : {}) });
            if (messages.size === 0) break;

            const toDelete = messages.filter(m => !m.author.bot);
            if (toDelete.size > 0) {
                await channel.bulkDelete(toDelete, true);
                deleted += toDelete.size;
            }

            if (toDelete.size === 0) break;
            lastId = messages.last()?.id;
        }

        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor(0x00FF00)
                .setDescription(`🧹 Deleted **${deleted}** non-bot message(s).`)
                .setTimestamp()]
        });
        return;
    }

    // /convert
    if (commandName === "convert") {
        const attachment = interaction.options.getAttachment("file", true);

        try {
            // Fetch the uploaded file content
            const res = await fetch(attachment.url);
            const text = await res.text();
            const usernames: string[] = JSON.parse(text);

            if (!Array.isArray(usernames) || usernames.some(u => typeof u !== "string")) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(0xFF0000)
                        .setDescription("❌ Invalid file format. Expected a JSON array of usernames.")]
                });
                return;
            }

            // Look up each username from the Mojang API
            const result: Record<string, string> = {};
            const failed: string[] = [];

            for (const username of usernames) {
                try {
                    const mojang = await fetch(`https://api.mojang.com/users/profiles/minecraft/${username}`);
                    if (mojang.ok) {
                        const data = await mojang.json() as { id: string; name: string };
                        // Mojang returns UUID without dashes — insert them
                        const raw = data.id;
                        const uuid = `${raw.slice(0,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}-${raw.slice(16,20)}-${raw.slice(20)}`;
                        result[uuid] = data.name;
                    } else {
                        failed.push(username);
                    }
                } catch {
                    failed.push(username);
                }
                // Mojang rate limit: ~1 req/600ms to be safe
                await new Promise(r => setTimeout(r, 650));
            }

            // Build output JSON file
            const output = JSON.stringify(result, null, 2);
            const buffer = Buffer.from(output, "utf-8");
            const { AttachmentBuilder } = await import("discord.js");
            const file = new AttachmentBuilder(buffer, { name: "converted.json" });

            let description = `✅ Converted **${Object.keys(result).length}** username(s).`;
            if (failed.length > 0) {
                description += `\n⚠️ Could not find UUID for: ${failed.map(u => `\`${u}\``).join(", ")}`;
            }

            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0x00FF00).setDescription(description).setTimestamp()],
                files: [file]
            });

        } catch (err) {
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(0xFF0000)
                    .setDescription("❌ Failed to process file. Make sure it's a valid JSON array.")]
            });
        }
        return;
    }

    // /fetch_accounts
    if (commandName === "fetch_accounts") {
        const input = interaction.options.getString("target", true);

        // Find the whitelist entry by username or hwid
        const list = getWhitelist();
        const entry = list.find(e =>
            e.hwid.toLowerCase() === input.toLowerCase() ||
            e.usernames.some(u => u.username.toLowerCase() === input.toLowerCase())
        );

        if (!entry) {
            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setDescription(`❌ No whitelist entry found for **${input}**.`)
                    .setTimestamp()]
            });
            return;
        }

        // Show known accounts immediately
        const requestId = generateRequestId();
        await interaction.editReply({
            embeds: [buildAccountsEmbed(entry, null, false)]
        });

        // Find any approved online client to send the scan request to
        let sentRequest = false;
        for (const user of connectedUsers.values()) {
            if (user.approved) {
                user.socket.send(JSON.stringify({
                    type: "fetch_accounts",
                    requestId,
                    targetHwid: entry.hwid
                }));
                sentRequest = true;
                break;
            }
        }

        if (sentRequest) {
            // Register the pending request — auto-timeout after 15s
            registerPendingRequest(requestId, interaction, entry);
        } else {
            // No online clients — show known accounts with a note
            await interaction.editReply({
                embeds: [buildAccountsEmbed(entry, null, true)]
            });
        }
        return;
    }
}

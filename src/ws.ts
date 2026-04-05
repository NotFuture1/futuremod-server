import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { isValidToken } from "./auth";
import { addUser, getOnlineUsernames, getUser, removeUser, connectedUsers } from "./state";
import { ClientMessage, ConnectedUser, ServerMessage, DenickEntry } from "./types";
import { sendApprovalRequest } from "./discord";
import { isWhitelisted, updateLastLogin } from "./whitelist";
import { resolveRequest } from "./fetch_accounts";

// Denick cache — nick (lowercase) -> entry, TTL 1 hour
const denickCache = new Map<string, DenickEntry>();

// Prune expired entries every 10 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of denickCache.entries()) {
        if (entry.expiresAt <= now) denickCache.delete(key);
    }
}, 600_000);

function send(socket: WebSocket, data: ServerMessage): void {
    socket.send(JSON.stringify(data));
}

function safeParse(raw: string): ClientMessage | null {
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export function setupWebSocketServer(wss: WebSocketServer): void {
    wss.on("connection", (socket: WebSocket, _req: IncomingMessage) => {
        let currentUsername: string | null = null;

        send(socket, {
            type: "hello",
            success: true,
            message: "Connected to futuremod server"
        });

        socket.on("message", async (data: Buffer) => {
            const msg = safeParse(data.toString());
            if (!msg || !msg.type) {
                send(socket, {
                    type: "error",
                    success: false,
                    message: "Invalid JSON or missing type"
                });
                return;
            }

            if (msg.type === "auth") {
                if (!isValidToken(msg.token)) {
                    send(socket, {
                        type: "auth_result",
                        success: false,
                        message: "Invalid token"
                    });
                    socket.close();
                    return;
                }

                if (!msg.username || !msg.uuid) {
                    send(socket, {
                        type: "auth_result",
                        success: false,
                        message: "Missing username or uuid"
                    });
                    return;
                }

                const hwid: string = msg.hwid || "unknown";

                const user: ConnectedUser = {
                    username: msg.username,
                    uuid: msg.uuid,
                    hwid,
                    socket,
                    authenticated: true,
                    approved: false,
                    connectedAt: Date.now(),
                    lastHeartbeat: Date.now(),
                    presence: {}
                };

                addUser(user);
                currentUsername = msg.username;

                send(socket, {
                    type: "auth_result",
                    success: true,
                    message: "Authenticated — awaiting approval"
                });

                if (isWhitelisted(hwid)) {
                    // Known HWID — approve immediately, no Discord embed needed
                    user.approved = true;
                    await updateLastLogin(hwid, msg.username);
                    send(socket, { type: "approved" });
                    send(socket, {
                        type: "online_users",
                        success: true,
                        onlineUsers: getOnlineUsernames()
                    });
                } else {
                    // Unknown HWID — send Discord approval embed
                    sendApprovalRequest(msg.username, msg.uuid, hwid).catch(console.error);
                }

                return;
            }

            if (!currentUsername) {
                send(socket, {
                    type: "error",
                    success: false,
                    message: "Authenticate first"
                });
                return;
            }

            const currentUser = getUser(currentUsername);
            if (!currentUser) {
                send(socket, {
                    type: "error",
                    success: false,
                    message: "Session not found"
                });
                return;
            }

            // Block all actions until Discord approval
            if (!currentUser.approved) {
                send(socket, {
                    type: "error",
                    success: false,
                    message: "Awaiting approval"
                });
                return;
            }

            if (msg.type === "heartbeat") {
                currentUser.lastHeartbeat = Date.now();
                send(socket, {
                    type: "heartbeat_ack",
                    success: true
                });
                return;
            }

            if (msg.type === "presence_update") {
                currentUser.lastHeartbeat = Date.now();
                currentUser.presence = {
                    ...currentUser.presence,
                    ...(msg.presence || {})
                };
                send(socket, {
                    type: "presence_ack",
                    success: true
                });
                return;
            }

            if (msg.type === "get_online_users") {
                send(socket, {
                    type: "online_users",
                    success: true,
                    onlineUsers: getOnlineUsernames()
                });
                return;
            }

            if (msg.type === "get_player_presence") {
                if (!msg.targetUsername) {
                    send(socket, {
                        type: "player_presence",
                        success: false,
                        message: "Missing targetUsername"
                    });
                    return;
                }

                const target = getUser(msg.targetUsername);
                if (!target) {
                    send(socket, {
                        type: "player_presence",
                        success: false,
                        message: "Target not online",
                        targetUsername: msg.targetUsername
                    });
                    return;
                }

                send(socket, {
                    type: "player_presence",
                    success: true,
                    targetUsername: target.username,
                    presence: target.presence
                });
                return;
            }

            if (msg.type === "venom_applied") {
                if (!msg.victimUuid || !msg.venomEndMs) {
                    send(socket, {
                        type: "error",
                        success: false,
                        message: "Missing victimUuid or venomEndMs"
                    });
                    return;
                }

                // Broadcast to all OTHER approved clients so their timers sync
                const broadcast: ServerMessage = {
                    type: "venom_applied",
                    victimUuid: msg.victimUuid,
                    venomEndMs: msg.venomEndMs
                };

                let count = 0;
                for (const user of connectedUsers.values()) {
                    if (user.approved && user.username !== currentUsername) {
                        user.socket.send(JSON.stringify(broadcast));
                        count++;
                    }
                }

                console.log(`[WS] Venom broadcast for ${msg.victimUuid} to ${count} client(s)`);
                return;
            }

            if (msg.type === "denick_result") {
                if (!msg.nick || !msg.nickUuid || !msg.real) {
                    send(socket, {
                        type: "error",
                        success: false,
                        message: "Missing nick, nickUuid, or real"
                    });
                    return;
                }

                // Store in cache with 1 hour TTL
                const entry: DenickEntry = {
                    nick: msg.nick,
                    nickUuid: msg.nickUuid,
                    real: msg.real,
                    expiresAt: Date.now() + 3_600_000
                };
                denickCache.set(msg.nick.toLowerCase(), entry);

                // Broadcast to all OTHER approved clients
                const broadcast: ServerMessage = {
                    type: "denick_result",
                    nick: msg.nick,
                    nickUuid: msg.nickUuid,
                    real: msg.real
                };

                let count = 0;
                for (const user of connectedUsers.values()) {
                    if (user.approved && user.username !== currentUsername) {
                        user.socket.send(JSON.stringify(broadcast));
                        count++;
                    }
                }

                console.log(`[WS] Denick cached: ${msg.nick} -> ${msg.real}, broadcast to ${count} client(s)`);
                return;
            }

            if (msg.type === "get_denicks") {
                const now = Date.now();
                const entries = Array.from(denickCache.values()).filter(e => e.expiresAt > now);
                send(socket, {
                    type: "denick_list",
                    denicks: entries
                });
                return;
            }

            if (msg.type === "fetch_accounts_result") {
                if (msg.requestId && msg.accounts) {
                    await resolveRequest(msg.requestId, msg.accounts);
                }
                return;
            }

            send(socket, {
                type: "error",
                success: false,
                message: `Unknown message type: ${msg.type}`
            });
        });

        socket.on("close", () => {
            if (currentUsername) {
                removeUser(currentUsername);
            }
        });

        socket.on("error", () => {
            if (currentUsername) {
                removeUser(currentUsername);
            }
        });
    });
}

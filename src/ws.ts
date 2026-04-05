import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { isValidToken } from "./auth";
import { addUser, getOnlineUsernames, getUser, removeUser } from "./state";
import { ClientMessage, ConnectedUser, ServerMessage } from "./types";
import { sendApprovalRequest } from "./discord";
import { isWhitelisted } from "./whitelist";

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

        socket.on("message", (data: Buffer) => {
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

import { WebSocket } from "ws";

export interface PresenceData {
    server?: string;
    gametype?: string;
    map?: string;
    x?: number;
    y?: number;
    z?: number;
    venomTimer?: number;
    usersVisible?: string[];
}

export interface ConnectedUser {
    username: string;
    uuid: string;
    socket: WebSocket;
    authenticated: boolean;
    connectedAt: number;
    lastHeartbeat: number;
    presence: PresenceData;
}

export interface ClientMessage {
    type: string;
    token?: string;
    username?: string;
    uuid?: string;
    targetUsername?: string;
    presence?: PresenceData;
}

export interface ServerMessage {
    type: string;
    success?: boolean;
    message?: string;
    targetUsername?: string;
    onlineUsers?: string[];
    presence?: PresenceData;
}
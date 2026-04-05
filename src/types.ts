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
    hwid: string;
    socket: WebSocket;
    authenticated: boolean;
    approved: boolean;
    connectedAt: number;
    lastHeartbeat: number;
    presence: PresenceData;
}

export interface ClientMessage {
    type: string;
    token?: string;
    username?: string;
    uuid?: string;
    hwid?: string;
    targetUsername?: string;
    presence?: PresenceData;
    // venom_applied
    victimUsername?: string;
    victimUuid?: string;
    venomEndMs?: number;
    victimHasVenoms?: boolean;
    // denick_result
    nick?: string;
    nickUuid?: string;
    real?: string;
}

export interface ServerMessage {
    type: string;
    success?: boolean;
    message?: string;
    targetUsername?: string;
    onlineUsers?: string[];
    presence?: PresenceData;
    reason?: string;
    // venom_applied broadcast
    victimUuid?: string;
    venomEndMs?: number;
    // denick
    nick?: string;
    nickUuid?: string;
    real?: string;
    denicks?: DenickEntry[];
}

export interface DenickEntry {
    nick: string;
    nickUuid: string;
    real: string;
    expiresAt: number;
}

export interface UsernameEntry {
    username: string;
    lastLogin: number;
}

export interface WhitelistEntry {
    hwid: string;
    usernames: UsernameEntry[];
}

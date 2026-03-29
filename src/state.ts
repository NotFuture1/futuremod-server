import { ConnectedUser } from "./types";

export const connectedUsers = new Map<string, ConnectedUser>();

export function addUser(user: ConnectedUser): void {
    connectedUsers.set(user.username.toLowerCase(), user);
}

export function getUser(username: string): ConnectedUser | undefined {
    return connectedUsers.get(username.toLowerCase());
}

export function removeUser(username: string): void {
    connectedUsers.delete(username.toLowerCase());
}

export function getOnlineUsernames(): string[] {
    return Array.from(connectedUsers.values()).map(user => user.username);
}
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer } from "ws";
import { setupWebSocketServer } from "./ws";
import { getOnlineUsernames } from "./state";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
    res.json({
        ok: true,
        message: "futuremod backend is running"
    });
});

app.get("/health", (_req, res) => {
    res.json({
        ok: true,
        onlineUsers: getOnlineUsernames()
    });
});

const port = Number(process.env.PORT || 3000);
const server = http.createServer(app);

const wss = new WebSocketServer({ server });
setupWebSocketServer(wss);

server.listen(port, () => {
    console.log(`HTTP/WebSocket server running on port ${port}`);
});
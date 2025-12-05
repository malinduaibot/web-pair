const express = require('express');
const fs = require('fs');
const { exec } = require("child_process");
let router = express.Router()
const pino = require("pino");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser
} = require("@whiskeysockets/baileys");
const { upload } = require('./mega');

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
    let num = req.query.number;

    async function MalinduPair() {
        const { state, saveCreds } = await useMultiFileAuthState(`./session`);

        try {
            let MalinduPairWeb = makeWASocket({
                auth: state,
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }),
                browser: Browsers.macOS("Safari"),
            });

            // Number sanitize
            num = num?.replace(/[^0-9]/g, '');
            if (!num || num.length < 10) {
                if (!res.headersSent) res.send({ code: "Invalid Number" });
                return;
            }

            if (!MalinduPairWeb.authState.creds.registered) {
                await delay(1500);
                const code = await MalinduPairWeb.requestPairingCode(num);
                if (!res.headersSent) {
                    await res.send({ code });
                }
            }

            MalinduPairWeb.ev.on('creds.update', saveCreds);

            MalinduPairWeb.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === "open") {
                    try {
                        await delay(10000);
                        const auth_path = './session/';
                        const user_jid = jidNormalizedUser(MalinduPairWeb.user.id);

                        function randomMegaId(length = 6, numberLength = 4) {
                            const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                            let result = '';
                            for (let i = 0; i < length; i++) {
                                result += characters.charAt(Math.floor(Math.random() * characters.length));
                            }
                            const number = Math.floor(Math.random() * Math.pow(10, numberLength));
                            return `${result}${number}`;
                        }

                        let mega_url;
                        try {
                            mega_url = await upload(fs.createReadStream(auth_path + 'creds.json'), `${randomMegaId()}.json`);
                        } catch (e) {
                            console.log("Mega upload failed", e);
                        }

                        if (mega_url) {
                            const string_session = mega_url.replace('https://mega.nz/file/', '');
                            await MalinduPairWeb.sendMessage(user_jid, { text: string_session });
                        }

                        await removeFile('./session');
                        console.log("Session uploaded and cleared.");

                    } catch (e) {
                        console.log("Error during session handling", e);
                        exec('pm2 restart danuwa');
                    }
                } else if (connection === "close") {
                    if (lastDisconnect?.error?.output?.statusCode !== 401) {
                        console.log("Reconnecting in 5s...");
                        setTimeout(MalinduPair, 5000);
                    }
                }
            });

        } catch (err) {
            console.log("Service error:", err);
            exec('pm2 restart MALINDI-AI-BOT');
            await removeFile('./session');
            if (!res.headersSent) {
                await res.send({ code: "Service Unavailable" });
            }
        }
    }

    return await MalinduPair();
});

process.on('uncaughtException', function (err) {
    console.log('Caught exception: ' + err);
    exec('pm2 restart danuwa');
});

module.exports = router;

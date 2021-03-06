import axios from "axios";
import * as crypto from "crypto";
import { encode, decode } from "iconv-lite";
import express from "express";
import schedule from "node-schedule";
import * as fs from "fs";
import nReadlines from "n-readlines";
import { DateTime } from "luxon";

const PASSWORD = process.env.FRITZOS_PASSWORD;
const USERNAME = process.env.FRITZOS_USERNAME;
const BASE_URL = process.env.FRITZOS_URL || "http://fritz.box";
const CRON_PATTERN = process.env.CRON_PATTERN || "* * * * *";
const PORT = Number(process.env.PORT || 3000);
const LOG_PATH = process.env.LOG_PATH || "./fritz.log";

const hash = (value: crypto.BinaryLike, algorithm: string = "md5") => {
  return crypto.createHash(algorithm).update(value).digest("hex");
};

let cachedSID;
const getSID = async () => {
  if (cachedSID) return cachedSID;
  console.log("Logging in to fritzbox");
  const login = await axios.get(`${BASE_URL}/login_sid.lua`).then((a) => a.data);

  const challenge = login.match(/<Challenge>(.*)<\/Challenge>/)[1];
  const challengeString = `${challenge}-${PASSWORD}`;
  const encodedChallengeString = encode(decode(Buffer.from(challengeString), "utf8"), "utf16le");

  const md5 = hash(encodedChallengeString);
  const responseString = `${challenge}-${md5}`;
  const session = await axios
    .get(`${BASE_URL}/login_sid.lua?user=${USERNAME}&response=${responseString}`)
    .then((a) => a.data);
  cachedSID = session.match(/<SID>(.*)<\/SID>/)[1];
  return cachedSID;
};

type LogRecord = {
  timestamp: string;
  unixMs: number;
  message: string;
  code: string;
  type: string;
};
const getLogs = async () => {
  const SID = await getSID();
  const data = await axios
    .post(`${BASE_URL}/data.lua`, `xhr=1&sid=${SID}&lang=en&page=log&xhrId=all`, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    })
    .then((a) => a.data);
  try {
    const records: LogRecord[] = data.data.log.map((row) => {
      const [date, time, message, code, type] = row;
      const timestamp = DateTime.fromFormat(`${date} ${time}`, "dd.MM.yy HH:mm:ss");
      return {
        timestamp: timestamp.toISO(),
        message,
        code,
        type,
        unixMs: timestamp.toMillis(),
      };
    });
    records.sort((a, b) => a.unixMs - b.unixMs);
    return records;
  } catch (e) {
    console.error(data);
    throw e;
  }
};

process.on("beforeExit", async () => {
  const SID = await getSID();
  console.log("Logging out from fritzbox");
  await axios.get(`${BASE_URL}/login_sid.lua?logout=1&sid=${SID}`);
});

const DIRECTORY = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Fritzlogs</title>
</head>
<body>
  <ul>
    <li><a href="/logs">/logs</a></li>
  </ul>
</body>
</html>
`;

const initialize = async () => {
  let cursor: number = 0;
  if (fs.existsSync(LOG_PATH)) {
    console.log(`Reading existing log at ${LOG_PATH}`);
    const lines = new nReadlines(LOG_PATH);
    let line;

    while ((line = lines.next())) {
      const record: LogRecord = JSON.parse(line);
      if (cursor < record.unixMs) cursor = record.unixMs;
    }
  }

  const load = async () => {
    const rows = await getLogs();
    let count = 0;
    for (let row of rows) {
      const logLine = JSON.stringify(row);
      if (cursor < row.unixMs) {
        count += 1;
        fs.appendFileSync(LOG_PATH, logLine + "\n");
        cursor = row.unixMs;
      }
    }
    console.log(`${rows.length} rows loaded, ${count} rows logged`);
  };

  await load();

  console.log(`Setting the periodic load with: ${CRON_PATTERN}`);
  schedule.scheduleJob(CRON_PATTERN, load);
};

initialize().then(() => {
  const app = express();

  app.get("/", (req, res) => {
    res.contentType("html").send(DIRECTORY);
  });

  app.get("/logs", async (req, res) => {
    res.contentType("text/plain").send(fs.readFileSync(LOG_PATH));
  });

  app.listen(PORT, () => console.log(`Server is listening on ${PORT}`));
});

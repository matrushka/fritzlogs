import axios from "axios";
import * as crypto from 'crypto';
import * as iconv from 'iconv-lite';
import express from 'express';

const PASSWORD = process.env.FRITZOS_PASSWORD
const USERNAME = process.env.FRITZOS_USERNAME
const BASE_URL = process.env.FRITZOS_URL || "http://fritz.box";
const PORT = Number(process.env.PORT || 3000);

let cachedSID;
const getSID = async () => {
  if (cachedSID) return cachedSID;
  console.log('Logging in to fritzbox');
  const login = await axios.get(`${BASE_URL}/login_sid.lua`).then(a => a.data)
  const challenge = login.match(/<Challenge>(.*)<\/Challenge>/)[1];
  const challengeString = `${challenge}-${PASSWORD}`;
  const encodedChallengeString = iconv.encode(iconv.decode(Buffer.from(challengeString), 'utf8'), 'utf16le');
  const md5 = crypto.createHash('md5').update(encodedChallengeString).digest("hex");
  const responseString=`${challenge}-${md5}`
  const session = await axios.get(`${BASE_URL}/login_sid.lua?user=${USERNAME}&response=${responseString}`).then(a => a.data)
  cachedSID = session.match(/<SID>(.*)<\/SID>/)[1];
  return cachedSID;
}

const getLogs = async () => {
  const SID = await getSID();
  const data = await axios.post(`${BASE_URL}/data.lua`, `xhr=1&sid=${SID}&lang=en&page=log&xhrId=all`, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  }).then(a => a.data);
  const logs = (data.data.log.map(a => a.join("\t")).join("\n") as string).replaceAll(SID, '${SID}');

  return logs;
}

process.on('beforeExit', async () => {
  const SID = await getSID()
  console.log('Logging out from fritzbox');
  await axios.get(`${BASE_URL}/login_sid.lua?logout=1&sid=${SID}`);
})

const app = express()
app.get('/', async (req, res) => {
  let logs;
  try {
    logs = await getLogs();
  } catch (e) {
    cachedSID = null;
    console.log('Retrying with a new sesion')
    logs = await getLogs();
  }
  res.contentType('text/plain').send(logs);
})

app.listen(PORT, () => console.log(`Server is listening on ${PORT}`))

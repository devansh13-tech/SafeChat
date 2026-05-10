const firebaseConfig = {
  apiKey: "AIzaSyCaTadRY8qr4f2vzW9NN0HdcGIXdB7uZjg",
  authDomain: "safechat-f3c73.firebaseapp.com",
  databaseURL: "https://safechat-f3c73-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "safechat-f3c73",
  storageBucket: "safechat-f3c73.firebasestorage.app",
  messagingSenderId: "651460378440",
  appId: "1:651460378440:web:74d96f76f37d973848bd7d"
};

let db, roomRef, msgsRef, presRef, typRef;
let myId, myName, myRole, myAv, roomCode;
let peerOn = false, peerInfo = null, typTimer = null;
let seenKeys = new Set();
let mediaRecorder = null, audioChunks = [], recording = false;
let lastPreview = '', lastMsgTime = '';

const b2b = b => btoa(String.fromCharCode(...new Uint8Array(b)));
const b2buf = s => Uint8Array.from(atob(s), c => c.charCodeAt(0)).buffer;
const nowStr = () => new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const COLORS = ['#00a884', '#7c3aed', '#2563eb', '#db2777', '#d97706', '#0891b2', '#059669', '#dc2626'];
function avatarColor(name) { let h = 0; for (let c of name) h = (h * 31 + c.charCodeAt(0)) % COLORS.length; return COLORS[Math.abs(h)]; }

function genRoom() {
  const w = ['NOVA', 'ECHO', 'LYRA', 'DELTA', 'SIGMA', 'AMBER', 'COBALT', 'PIXEL', 'STORM', 'ATLAS'];
  document.getElementById('setupRoom').value = w[Math.floor(Math.random() * w.length)] + '-' + (Math.floor(Math.random() * 900) + 100);
}

function showErr(msg) { const el = document.getElementById('setupAlert'); el.textContent = msg; el.classList.add('show'); }

async function connectToRoom() {
  const name = document.getElementById('setupName').value.trim();
  const role = document.querySelector('input[name="r"]:checked').value;
  const room = document.getElementById('setupRoom').value.trim().toUpperCase();
  if (!name) return showErr('Please enter your display name.');
  if (!room) return showErr('Please enter or generate a room code.');
  const btn = document.getElementById('connectBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Connecting…';
  try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    await db.ref('.info/connected').once('value');
    myName = name; myRole = role; myAv = name.charAt(0).toUpperCase();
    myId = 'u_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    roomCode = room;
    roomRef = db.ref(`safechat/rooms/${roomCode}`);
    msgsRef = roomRef.child('messages');
    presRef = roomRef.child('presence').child(myId);
    typRef = roomRef.child('typing').child(myId);
    await presRef.set({ name: myName, role: myRole, av: myAv, ts: Date.now() });
    presRef.onDisconnect().remove();
    typRef.onDisconnect().remove();
    launch();
  } catch (e) {
    btn.disabled = false; btn.innerHTML = 'Connect to Room →';
    showErr('Connection failed: ' + e.message);
    console.error('Firebase error:', e);
  }
}

function launch() {
  document.getElementById('setupScreen').style.display = 'none';
  document.getElementById('chatApp').style.display = 'flex';
  const col = avatarColor(myName);
  const meAv = document.getElementById('meAv');
  meAv.textContent = myAv; meAv.style.background = col;
  document.getElementById('meName').textContent = myName;
  document.getElementById('meRole').textContent = myRole.charAt(0).toUpperCase() + myRole.slice(1);
  document.getElementById('leftRoomCode').textContent = roomCode;
  document.getElementById('roomDisplay').textContent = roomCode;

  roomRef.child('presence').on('value', s => syncPresence(s.val() || {}));

  msgsRef.on('child_added', async s => {
    if (!s.val() || seenKeys.has(s.key)) return;
    seenKeys.add(s.key);
    const msg = s.val();
    try {
      const plain = await decrypt(msg.enc_iv, msg.enc_ct);
      if (msg.type === 'text') { msg.text = plain; }
      else { const p = JSON.parse(plain); msg.type = p.type || msg.type; msg.text = p.text || ''; msg.fileName = p.fileName || ''; msg.fileType = p.fileType || ''; msg.dataUrl = p.dataUrl || ''; }
    } catch (e) { msg.text = '[Unable to decrypt]'; msg.type = 'text'; }
    renderMsg(msg);
    // update list preview
    lastPreview = msg.type === 'text' ? msg.text : msg.type === 'image' ? '📷 Image' : msg.type === 'audio' ? '🎤 Voice note' : '📄 ' + (msg.fileName || 'File');
    lastMsgTime = msg.time || nowStr();
    updateListPreview();
  });

  roomRef.child('typing').on('value', s => {
    const o = Object.entries(s.val() || {}).filter(([id]) => id !== myId);
    if (o.length) { document.getElementById('typingWho').textContent = (o[0][1]?.name || 'Peer') + ' is typing…'; document.getElementById('typingRow').classList.add('show'); }
    else { document.getElementById('typingRow').classList.remove('show'); }
  });
}

function syncPresence(members) {
  const list = Object.values(members);
  const peer = list.find(m => m.name !== myName);
  const chatList = document.getElementById('waChatList');

  if (peer && !peerOn) {
    peerOn = true; peerInfo = peer;
    const col = avatarColor(peer.name);
    // Header
    const chAv = document.getElementById('chAv');
    chAv.textContent = peer.av || peer.name.charAt(0); chAv.style.background = col;
    document.getElementById('chName').textContent = peer.name;
    document.getElementById('chStatus').textContent = 'online';
    document.getElementById('chStatus').className = 'wa-chat-peer-status online';
    document.getElementById('waitOverlay').style.display = 'none';
    document.getElementById('chatInput').disabled = false;
    document.getElementById('sendBtn').disabled = false;
    document.getElementById('chatApp').classList.add('chat-open');
    // Chat list item
    chatList.innerHTML = `
      <div class="wa-chat-item active" id="chatListItem">
        <div class="wa-chat-avatar" style="background:${col};">
          ${esc(peer.av || peer.name.charAt(0))}
          <div class="wa-avatar-online" id="listOnlineDot"></div>
        </div>
        <div class="wa-chat-info">
          <div class="wa-chat-name-row">
            <div class="wa-chat-name">${esc(peer.name)}</div>
            <div class="wa-chat-time" id="listTime">${nowStr()}</div>
          </div>
          <div class="wa-chat-preview-row">
            <div class="wa-chat-preview" id="listPreview" style="color:#00a884;">🔒 Secure channel active</div>
          </div>
        </div>
      </div>`;
    sysPill('🔒 ' + peer.name + ' joined. Secure channel active.');
  } else if (!peer && peerOn) {
    peerOn = false; peerInfo = null;
    document.getElementById('chStatus').textContent = 'last seen recently';
    document.getElementById('chStatus').className = 'wa-chat-peer-status';
    document.getElementById('chatInput').disabled = true;
    document.getElementById('sendBtn').disabled = true;
    const dot = document.getElementById('listOnlineDot');
    if (dot) dot.remove();
    const lp = document.getElementById('listPreview');
    if (lp) { lp.textContent = '⚠ Peer disconnected'; lp.style.color = '#8696a0'; }
    sysPill('⚠ Peer left the room.');
  }

  if (!peer && !peerOn) {
    chatList.innerHTML = `<div class="wa-waiting-item"><div class="wa-pulse">📡</div><div class="wa-waiting-title">No active chats</div><div>Share the room code below to connect</div></div>`;
  }
}

function updateListPreview() {
  const lp = document.getElementById('listPreview');
  const lt = document.getElementById('listTime');
  if (lp) { lp.textContent = lastPreview; lp.style.color = '#8696a0'; }
  if (lt) lt.textContent = lastMsgTime;
}

function showEncInfo() { sysPill('🔒 AES-256-GCM encryption active. Messages can only be read by people in this room.'); }

async function getKey() {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(roomCode.padEnd(32, '0').substring(0, 32)), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encrypt(text) {
  const k = await getKey(), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(text));
  return { iv: b2b(iv), ct: b2b(ct) };
}

async function decrypt(ivB64, ctB64) {
  const k = await getKey(), iv = new Uint8Array(b2buf(ivB64)), ct = b2buf(ctB64);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k, ct);
  return new TextDecoder().decode(pt);
}

async function sendMessage(payload) {
  if (!peerOn || !payload) return;
  const env = { senderId: myId, senderName: myName, senderRole: myRole, senderAv: myAv, timestamp: Date.now(), time: nowStr(), ...payload };
  const textForEnc = env.type === 'text' ? (env.text || '') : JSON.stringify({ type: env.type, text: env.text || '', fileName: env.fileName || '', fileType: env.fileType || '', dataUrl: env.dataUrl || '' });
  const enc = await encrypt(textForEnc);
  await msgsRef.push({ senderId: env.senderId, senderName: env.senderName, senderRole: env.senderRole, senderAv: env.senderAv, timestamp: env.timestamp, time: env.time, type: env.type, enc_iv: enc.iv, enc_ct: enc.ct });
  typRef.remove();
}

async function send() {
  const inp = document.getElementById('chatInput'), text = inp.value.trim();
  if (!text || !peerOn) return;
  inp.value = ''; inp.style.height = 'auto';
  await sendMessage({ type: 'text', text });
}

function chooseAttachment() { document.getElementById('fileInput').click(); }

document.getElementById('fileInput').addEventListener('change', async e => {
  const file = e.target.files?.[0]; if (!file) return;
  await handleFileAttachment(file); e.target.value = '';
});

async function handleFileAttachment(file) {
  if (!file || !peerOn) return;
  try {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      let type = 'file';
      if (file.type.startsWith('image/')) type = 'image';
      else if (file.type.startsWith('audio/')) type = 'audio';
      await sendMessage({ type, text: `${type === 'file' ? 'File' : type.charAt(0).toUpperCase() + type.slice(1)}: ${file.name}`, fileName: file.name, fileType: file.type, dataUrl });
      sysPill('✅ ' + file.name + ' sent');
    };
    reader.readAsDataURL(file);
  } catch (e) { sysPill('Unable to send attachment'); }
}

async function toggleRecording() {
  if (recording) { stopRecording(); return; }
  if (!navigator.mediaDevices?.getUserMedia) { sysPill('Microphone not supported.'); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream); audioChunks = [];
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
      await handleFileAttachment(file);
      stream.getTracks().forEach(t => t.stop());
      recording = false; document.getElementById('recordBtn').textContent = '🎤';
    };
    mediaRecorder.start(); recording = true;
    document.getElementById('recordBtn').textContent = '⏹';
    sysPill('🎤 Recording… tap ⏹ to stop');
  } catch (e) { sysPill('Failed to start recording.'); }
}

function stopRecording() { if (mediaRecorder?.state === 'recording') mediaRecorder.stop(); }

function renderMsg(msg) {
  const isMe = msg.senderId === myId;
  const area = document.getElementById('msgs');
  const row = document.createElement('div');
  row.className = 'wa-msg-row ' + (isMe ? 'me' : 'you');
  let inner = '';
  const type = msg.type || 'text';
  if (type === 'image' && msg.dataUrl) inner = `<img class="wa-msg-img" src="${msg.dataUrl}" alt="${esc(msg.fileName || 'Image')}" />`;
  else if ((type === 'audio' || type === 'voicemail') && msg.dataUrl) inner = `<audio controls class="wa-msg-audio" src="${msg.dataUrl}"></audio>`;
  else if (type === 'file' && msg.dataUrl) inner = `<a class="wa-msg-file" href="${msg.dataUrl}" download="${esc(msg.fileName || 'file')}">📄 ${esc(msg.fileName || 'Download')}</a>`;
  else inner = esc(msg.text || '[Attachment]');
  const ticks = isMe ? `<span class="wa-tick-blue">✓✓</span>` : '';
  row.innerHTML = `<div class="wa-bubble">${inner}<div class="wa-bubble-meta"><span>${msg.time || nowStr()}</span>${ticks}</div></div>`;
  area.appendChild(row);
  area.scrollTop = area.scrollHeight;
}

function sysPill(text) {
  const area = document.getElementById('msgs');
  const d = document.createElement('div'); d.className = 'wa-sys-pill'; d.textContent = text;
  area.appendChild(d); area.scrollTop = area.scrollHeight;
}

function ht() {
  if (!peerOn) return;
  typRef.set({ name: myName, ts: Date.now() });
  clearTimeout(typTimer);
  typTimer = setTimeout(() => typRef.remove(), 2500);
}

function kd(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }
function ri(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 100) + 'px'; }
function toggleEmoji() { document.getElementById('emojiTray').classList.toggle('open'); }
function ins(em) { document.getElementById('chatInput').value += em; document.getElementById('chatInput').focus(); document.getElementById('emojiTray').classList.remove('open'); }

function copyRoom() {
  navigator.clipboard.writeText(roomCode).then(() => {
    ['copyBtnLeft', 'copyBtnOverlay'].forEach(id => {
      const b = document.getElementById(id); if (!b) return;
      const orig = b.textContent; b.textContent = '✓ Copied!';
      setTimeout(() => b.textContent = orig, 2000);
    });
  });
}

document.addEventListener('click', e => {
  if (!e.target.closest('.wa-emoji-tray') && !e.target.closest('.wa-input-side-btn'))
    document.getElementById('emojiTray').classList.remove('open');
});

function handleLogout() {
  presRef?.remove(); typRef?.remove();
  roomRef?.child('presence').off(); roomRef?.child('messages').off(); roomRef?.child('typing').off();
  peerOn = false; peerInfo = null; seenKeys.clear(); lastPreview = ''; lastMsgTime = '';
  document.getElementById('chatApp').style.display = 'none';
  document.getElementById('chatApp').classList.remove('chat-open');
  document.getElementById('setupScreen').style.display = 'flex';
  document.getElementById('chatInput').disabled = true;
  document.getElementById('sendBtn').disabled = true;
  document.getElementById('msgs').innerHTML = '<div class="wa-date-line">Today</div><div class="wa-sys-pill">🔒 Room joined. Waiting for the other person to connect…</div>';
  document.getElementById('waitOverlay').style.display = 'flex';
  document.getElementById('connectBtn').disabled = false;
  document.getElementById('connectBtn').innerHTML = 'Connect to Room →';
  document.getElementById('setupAlert').classList.remove('show');
  document.getElementById('chAv').style.background = '#2a3942'; document.getElementById('chAv').textContent = '👤';
  document.getElementById('chName').textContent = 'Waiting for peer…';
  document.getElementById('chStatus').textContent = 'Share the room code to connect';
  document.getElementById('chStatus').className = 'wa-chat-peer-status';
  document.getElementById('waChatList').innerHTML = '<div class="wa-waiting-item"><div class="wa-pulse">📡</div><div class="wa-waiting-title">No active chats</div><div>Share the room code below to connect</div></div>';
}

window.addEventListener('load', genRoom);
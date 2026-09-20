/* =========================================================
   CARA KERJA SECARA GARIS BESAR
   ---------------------------------------------------------
   Kita TIDAK punya server. Jadi browser si pembuat room (HOST)
   bertugas jadi "server mini":
     - Host terdaftar di PeerJS dengan ID = awalan + KODE ROOM
     - Teman (GUEST) menyambung ke ID itu
     - Guest kirim pesan ke host, host menyebarkan ke semua orang
   Kode room valid  = host berhasil dihubungi.
   Kode room salah  = tidak ada host dengan ID itu.
   ========================================================= */


/* =========================================================
   1. PENGATURAN
   ========================================================= */
const PEER_PREFIX = "chatroom-app-v1-";           // awalan ID supaya tidak bentrok dengan aplikasi lain
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // tanpa huruf/angka yang mirip (0/O, 1/I)
const CODE_LENGTH = 5;
const DEFAULT_TITLE = "Chat Room";

const EMOJIS = [
  "😀", "😁", "😂", "🤣", "😊", "😍", "😘", "😎", "🤔", "😴", "😭", "😡",
  "🥳", "🤯", "😱", "🙄", "👍", "👎", "👏", "🙏", "💪", "🤝", "👋", "🙌",
  "❤️", "💔", "🔥", "✨", "🎉", "💯", "⭐", "☕", "🍕", "🍔", "🍜", "⚽",
  "🎮", "🎵", "🚀", "🌈", "🐱", "🐶", "🦄", "🌸"
];


/* =========================================================
   2. AMBIL ELEMEN HTML
   ========================================================= */
const $ = (id) => document.getElementById(id);

const menuScreen = $("menuScreen");
const chatScreen = $("chatScreen");

const modalCode = $("modalCode");
const modalUsername = $("modalUsername");
const modalCreate = $("modalCreate");

const formCode = $("formCode");
const formUsername = $("formUsername");
const formCreate = $("formCreate");

const inputCode = $("inputCode");
const inputUsername = $("inputUsername");
const inputRoomName = $("inputRoomName");
const inputHostName = $("inputHostName");

const codeError = $("codeError");
const usernameError = $("usernameError");
const createError = $("createError");

const btnCheckCode = $("btnCheckCode");
const btnCreateSubmit = $("btnCreateSubmit");

const roomTitle = $("roomTitle");
const btnCopyCode = $("btnCopyCode");
const onlineCount = $("onlineCount");
const messagesEl = $("messages");
const emojiPanel = $("emojiPanel");
const chatForm = $("chatForm");
const messageInput = $("messageInput");
const btnEmoji = $("btnEmoji");
const btnSend = $("btnSend");
const toast = $("toast");


/* =========================================================
   3. STATE (data yang sedang dipakai aplikasi)
   ========================================================= */
const state = {
  peer: null,      // objek Peer milik kita
  role: null,      // "host" | "guest" | null (belum di dalam room)
  roomCode: "",
  roomName: "",
  username: "",
  hostConn: null,  // (guest) koneksi ke host
  log: [],         // semua pesan di room, dipakai juga untuk download log
  users: []        // daftar username yang sedang online
};

// (host saja) daftar koneksi guest: koneksi -> username
const clients = new Map();


/* =========================================================
   4. FUNGSI BANTU
   ========================================================= */
function cleanText(value, max) {
  // buang spasi berlebih, batasi panjang
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function randomCode() {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

function showModal(modal) {
  modal.classList.remove("hidden");
  const firstInput = modal.querySelector("input");
  if (firstInput) firstInput.focus();
}

function hideModal(modal) {
  modal.classList.add("hidden");
}

let toastTimer = null;
function showToast(text) {
  toast.textContent = text;
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 2500);
}

// Tutup koneksi & hapus data koneksi. Dipanggil saat batal, keluar, atau gagal.
function resetConnection() {
  const { peer, hostConn } = state;
  // kosongkan state DULU, supaya event "close" dari koneksi lama diabaikan
  state.peer = null;
  state.hostConn = null;
  state.role = null;
  clients.clear();

  if (hostConn) { try { hostConn.close(); } catch (e) { /* abaikan */ } }
  if (peer) { try { peer.destroy(); } catch (e) { /* abaikan */ } }
}


/* =========================================================
   5. MENAMPILKAN PESAN
   ---------------------------------------------------------
   PENTING: kita pakai textContent, BUKAN innerHTML.
   Kalau pakai innerHTML, orang bisa mengetik <script> di chat
   dan menjalankan kode di browser temannya (serangan XSS).
   ========================================================= */
function renderMessage(msg) {
  const li = document.createElement("li");

  if (msg.kind === "system") {
    li.className = "msg system";
    li.textContent = msg.text;
  } else {
    const mine = msg.user === state.username;
    li.className = "msg " + (mine ? "mine" : "theirs");

    const meta = document.createElement("div");
    meta.className = "msg-meta";

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = mine ? "Kamu" : msg.user;

    const time = document.createElement("span");
    time.textContent = formatTime(msg.time);

    meta.append(name, time);

    const body = document.createElement("div");
    body.className = "msg-body";
    body.textContent = msg.text;

    li.append(meta, body);
  }

  messagesEl.appendChild(li);
  messagesEl.scrollTop = messagesEl.scrollHeight; // auto-scroll ke pesan terbaru
}

function updateOnline() {
  onlineCount.textContent = state.users.length + " online";
  onlineCount.title = state.users.join(", ");
}

// Pesan sistem yang hanya muncul di layar kita sendiri (mis. "host menutup room")
function addLocalSystem(text) {
  const msg = { kind: "system", text, time: Date.now() };
  state.log.push(msg);
  renderMessage(msg);
}


/* =========================================================
   6. MASUK KE LAYAR CHAT
   ========================================================= */
function enterChat() {
  hideModal(modalCode);
  hideModal(modalUsername);
  hideModal(modalCreate);

  menuScreen.classList.add("hidden");
  chatScreen.classList.remove("hidden");

  roomTitle.textContent = state.roomName;
  document.title = state.roomName;               // judul tab browser = nama room
  btnCopyCode.textContent = "Kode: " + state.roomCode;

  messagesEl.innerHTML = "";
  state.log.forEach(renderMessage);
  updateOnline();

  messageInput.disabled = false;
  btnSend.disabled = false;
  btnEmoji.disabled = false;
  messageInput.focus();
}

function leaveRoom() {
  resetConnection();
  state.log = [];
  state.users = [];
  state.roomName = "";
  state.roomCode = "";
  state.username = "";

  emojiPanel.classList.add("hidden");
  chatScreen.classList.add("hidden");
  menuScreen.classList.remove("hidden");
  document.title = DEFAULT_TITLE;
}


/* =========================================================
   7. CREATE ROOM (jadi HOST)
   ========================================================= */
$("btnCreate").addEventListener("click", () => {
  inputRoomName.value = "";
  inputHostName.value = "";
  createError.textContent = "";
  btnCreateSubmit.disabled = false;
  showModal(modalCreate);
});

formCreate.addEventListener("submit", (e) => {
  e.preventDefault(); // cegah halaman reload
  const roomName = cleanText(inputRoomName.value, 30);
  const username = cleanText(inputHostName.value, 20);
  if (!roomName || !username) return;

  createError.textContent = "Membuat room...";
  btnCreateSubmit.disabled = true;
  tryCreateRoom(roomName, username, 0);
});

// Coba daftar ke PeerJS dengan kode acak. Kalau kode sudah dipakai, coba kode lain.
function tryCreateRoom(roomName, username, attempt) {
  if (attempt >= 5) {
    createError.textContent = "Gagal membuat room. Coba lagi sebentar lagi.";
    btnCreateSubmit.disabled = false;
    return;
  }

  const code = randomCode();
  const peer = new Peer(PEER_PREFIX + code);
  let opened = false;

  peer.on("open", () => {
    opened = true;
    state.peer = peer;
    state.role = "host";
    state.roomCode = code;
    state.roomName = roomName;
    state.username = username;
    state.log = [];
    state.users = [username];

    setupHost(peer);
    enterChat();
    publishMessage({ kind: "system", text: username + " membuat room" });
  });

  peer.on("error", (err) => {
    if (opened) {
      console.error("Peer error:", err);
      return;
    }
    if (err.type === "unavailable-id") {
      tryCreateRoom(roomName, username, attempt + 1); // kode bentrok, coba kode baru
    } else {
      createError.textContent = "Tidak bisa terhubung ke server (" + err.type + "). Cek internet kamu.";
      btnCreateSubmit.disabled = false;
    }
  });
}

// Pasang "telinga" host: siap menerima guest
function setupHost(peer) {
  peer.on("connection", (conn) => {
    conn.on("data", (data) => handleHostData(conn, data));
    conn.on("close", () => handleGuestLeft(conn));
    conn.on("error", () => handleGuestLeft(conn));
  });

  // Kalau terputus dari server PeerJS, coba sambung lagi
  peer.on("disconnected", () => {
    if (state.peer === peer) peer.reconnect();
  });
}

function getUsers() {
  return [state.username, ...clients.values()];
}

function usernameTaken(name) {
  return getUsers().some((u) => u.toLowerCase() === name.toLowerCase());
}

// Host: proses data yang dikirim guest
function handleHostData(conn, data) {
  if (!data || typeof data !== "object") return;

  if (data.type === "join") {
    const name = cleanText(data.username, 20);
    if (!name) {
      conn.send({ type: "join-error", reason: "Username tidak boleh kosong." });
      return;
    }
    if (usernameTaken(name)) {
      conn.send({ type: "join-error", reason: "Username sudah dipakai di room ini." });
      return;
    }

    clients.set(conn, name);
    // kirim info room + riwayat chat ke guest yang baru masuk
    conn.send({
      type: "welcome",
      roomName: state.roomName,
      roomCode: state.roomCode,
      history: state.log,
      users: getUsers()
    });
    publishMessage({ kind: "system", text: name + " bergabung" });
    broadcastUsers();
  }

  if (data.type === "chat") {
    const name = clients.get(conn);
    if (!name) return; // belum join, abaikan
    const text = String(data.text || "").trim().slice(0, 500);
    if (!text) return;
    publishMessage({ kind: "chat", user: name, text });
  }
}

function handleGuestLeft(conn) {
  if (!clients.has(conn)) return; // sudah diproses / belum pernah join
  const name = clients.get(conn);
  clients.delete(conn);
  publishMessage({ kind: "system", text: name + " keluar" });
  broadcastUsers();
}

// Host: simpan pesan ke log, tampilkan, lalu kirim ke semua guest
function publishMessage(msg) {
  msg.time = Date.now();
  state.log.push(msg);
  renderMessage(msg);
  broadcast({ type: "message", message: msg });
}

function broadcast(payload) {
  clients.forEach((name, conn) => {
    if (conn.open) conn.send(payload);
  });
}

function broadcastUsers() {
  state.users = getUsers();
  updateOnline();
  broadcast({ type: "users", users: state.users });
}


/* =========================================================
   8. JOIN ROOM (jadi GUEST)
   Langkah: isi kode -> cek kode -> isi username -> masuk
   ========================================================= */
$("btnJoin").addEventListener("click", () => {
  inputCode.value = "";
  codeError.textContent = "";
  btnCheckCode.disabled = false;
  showModal(modalCode);
});

formCode.addEventListener("submit", (e) => {
  e.preventDefault();
  const code = inputCode.value.trim().toUpperCase();
  if (code.length !== CODE_LENGTH) {
    codeError.textContent = "Kode room terdiri dari " + CODE_LENGTH + " karakter.";
    return;
  }
  checkCode(code);
});

// Langkah "cek kode": coba sambung ke host. Berhasil = kode valid.
function checkCode(code) {
  resetConnection();
  codeError.textContent = "Mengecek kode...";
  btnCheckCode.disabled = true;

  const peer = new Peer(); // ID acak untuk kita sendiri
  state.peer = peer;
  let finished = false;
  let timer = null;

  const fail = (message) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    resetConnection();
    codeError.textContent = message;
    btnCheckCode.disabled = false;
  };

  // kalau 10 detik tidak ada respon, anggap gagal
  timer = setTimeout(() => fail("Room tidak ditemukan atau host tidak merespons."), 10000);

  peer.on("error", (err) => {
    if (err.type === "peer-unavailable") {
      fail("Kode room tidak ditemukan.");
    } else {
      fail("Gagal terhubung ke server (" + err.type + ").");
    }
  });

  peer.on("open", () => {
    const conn = peer.connect(PEER_PREFIX + code);

    conn.on("open", () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);

      // Kode valid!
      state.hostConn = conn;
      state.roomCode = code;
      wireGuestConnection(conn);

      hideModal(modalCode);
      inputUsername.value = "";
      usernameError.textContent = "";
      showModal(modalUsername);
    });

    conn.on("error", () => fail("Gagal terhubung ke room."));
  });
}

// Setelah kode valid & username diisi, kirim permintaan join ke host
formUsername.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = cleanText(inputUsername.value, 20);
  if (!name || !state.hostConn) return;

  usernameError.textContent = "";
  state.username = name;
  state.hostConn.send({ type: "join", username: name });
});

// Guest: proses data dari host
function wireGuestConnection(conn) {
  conn.on("data", (data) => {
    if (!data || typeof data !== "object") return;

    switch (data.type) {
      case "welcome":
        state.role = "guest";
        state.roomName = data.roomName;
        state.roomCode = data.roomCode;
        state.log = data.history;
        state.users = data.users;
        enterChat();
        break;

      case "join-error":
        usernameError.textContent = data.reason;
        break;

      case "message":
        state.log.push(data.message);
        renderMessage(data.message);
        break;

      case "users":
        state.users = data.users;
        updateOnline();
        break;
    }
  });

  conn.on("close", () => {
    if (state.hostConn !== conn) return; // kita sendiri yang menutup, abaikan

    if (state.role === "guest") {
      // sedang di dalam chat: host pergi
      addLocalSystem("Host menutup room. Kamu masih bisa download chat log.");
      messageInput.disabled = true;
      btnSend.disabled = true;
      btnEmoji.disabled = true;
      emojiPanel.classList.add("hidden");
      resetConnection();
    } else {
      // masih di popup username
      hideModal(modalUsername);
      resetConnection();
      showToast("Room sudah ditutup oleh host.");
    }
  });
}


/* =========================================================
   9. MENGIRIM PESAN
   ========================================================= */
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;

  if (state.role === "host") {
    publishMessage({ kind: "chat", user: state.username, text });
  } else if (state.role === "guest" && state.hostConn && state.hostConn.open) {
    state.hostConn.send({ type: "chat", text });
    // pesan akan muncul setelah host menyebarkannya balik ke kita
  }

  messageInput.value = "";
  emojiPanel.classList.add("hidden");
  messageInput.focus();
});


/* =========================================================
   10. EMOJI
   ========================================================= */
EMOJIS.forEach((emoji) => {
  const btn = document.createElement("button");
  btn.type = "button"; // supaya tidak men-submit form
  btn.textContent = emoji;
  btn.addEventListener("click", () => insertAtCursor(messageInput, emoji));
  emojiPanel.appendChild(btn);
});

btnEmoji.addEventListener("click", () => {
  emojiPanel.classList.toggle("hidden");
});

// klik di luar panel = tutup panel
document.addEventListener("click", (e) => {
  if (!emojiPanel.contains(e.target) && e.target !== btnEmoji) {
    emojiPanel.classList.add("hidden");
  }
});

// Sisipkan teks di posisi kursor
function insertAtCursor(input, text) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  const pos = start + text.length;
  input.setSelectionRange(pos, pos);
  input.focus();
}


/* =========================================================
   11. DOWNLOAD CHAT LOG
   Ubah array state.log jadi teks, bungkus jadi file (Blob),
   lalu "klik" link download buatan kita.
   ========================================================= */
$("btnDownload").addEventListener("click", () => {
  const lines = state.log.map((m) => {
    const t = new Date(m.time).toLocaleString("id-ID");
    return m.kind === "system" ? `[${t}] * ${m.text}` : `[${t}] ${m.user}: ${m.text}`;
  });

  const header =
    `Chat log - ${state.roomName} (kode ${state.roomCode})\n` +
    `Diunduh: ${new Date().toLocaleString("id-ID")}\n` +
    "-".repeat(40) + "\n";

  const blob = new Blob([header + lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const fileName = (state.roomName || "room").replace(/[^\w\-]+/g, "_") + "-chatlog.txt";
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});


/* =========================================================
   12. TOMBOL LAIN-LAIN
   ========================================================= */
// Salin kode room
btnCopyCode.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(state.roomCode);
    showToast("Kode " + state.roomCode + " disalin");
  } catch (err) {
    showToast("Kode room: " + state.roomCode);
  }
});

// Keluar dari room
$("btnLeave").addEventListener("click", () => {
  if (state.role) {
    const question = state.role === "host"
      ? "Kamu host. Kalau keluar, room ditutup untuk semua orang. Lanjut?"
      : "Keluar dari room?";
    if (!confirm(question)) return;
  }
  leaveRoom();
});

// Tombol "Batal" di semua popup
document.querySelectorAll("[data-close]").forEach((btn) => {
  btn.addEventListener("click", () => {
    hideModal(btn.closest(".modal"));
    if (state.role === null) resetConnection(); // batalkan proses join yang setengah jalan
  });
});

// Peringatan kalau tab ditutup saat masih di dalam room
window.addEventListener("beforeunload", (e) => {
  if (state.role) e.preventDefault();
});
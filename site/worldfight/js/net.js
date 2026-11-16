// Jogo online (2026-11-15): conexão direta entre os dois navegadores (WebRTC) com a biblioteca PeerJS.
// O servidor público gratuito do PeerJS só apresenta os dois jogadores ("sinalização"); depois disso a
// luta trafega direto entre eles (ou por um servidor TURN quando a rede não deixa a ligação direta).
//
// Sala = código de 4 dígitos. Quem cria a sala é o 1P (lado esquerdo); quem entra é o 2P.
// A luta roda em "lockstep": o motor (fight/sim.js) é determinístico, então cada lado só manda os seus
// comandos de cada quadro e os dois simulam exatamente a mesma luta. Ver docs/ONLINE.md.

const PEERJS_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
const PREFIX = 'world-fighter-sala-';
const LOST_MS = 15000; // sem notícia do outro lado por este tempo = conexão perdida

class NetLink {
  constructor() {
    this.reset();
  }

  reset() {
    this.peer = null;
    this.conn = null;
    this.side = 0;            // 0 = 1P (criou a sala), 1 = 2P (entrou)
    this.code = null;
    this.handler = null;      // mensagens da cena atual
    this.queue = [];          // mensagens que chegaram entre uma cena e outra
    this.inputs = new Map();  // quadro -> comandos do outro lado (luta atual)
    this.sums = new Map();    // quadro -> conferência de sincronia do outro lado
    this.match = 0;           // número da luta (descarta comandos de lutas anteriores)
    this.onLost = null;
    this.closed = false;
    this.byeReceived = false;
    this.lastSeen = 0;
    this.rtt = 0;
    clearInterval(this.pinger);
    this.pinger = null;
  }

  get connected() { return !!this.conn && !this.closed; }
  get isHost() { return this.side === 0; }

  // a biblioteca só é baixada quando alguém abre o modo online
  loadLib() {
    if (window.Peer) return Promise.resolve();
    if (!this.libPromise) {
      this.libPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = PEERJS_URL;
        s.onload = () => resolve();
        s.onerror = () => { this.libPromise = null; reject(new Error('sem-internet')); };
        document.head.appendChild(s);
      });
    }
    return this.libPromise;
  }

  openPeer(id) {
    return new Promise((resolve, reject) => {
      let opened = false;
      const peer = id ? new window.Peer(id, { debug: 0 }) : new window.Peer({ debug: 0 });
      this.peer = peer;
      peer.on('open', () => { opened = true; resolve(peer); });
      peer.on('error', (err) => {
        if (!opened) { peer.destroy(); reject(err); return; }
        this.peerError?.(err);
      });
      // o celular pode derrubar a ligação com o servidor de sinalização ao trocar de app: reconecta
      peer.on('disconnected', () => { if (!this.closed && !peer.destroyed) peer.reconnect(); });
    });
  }

  // Cria a sala. Devolve o código; chama onGuest quando o 2P conectar.
  async host(onGuest) {
    this.close();
    this.reset();
    await this.loadLib();
    for (let tries = 0; tries < 6; tries++) {
      const code = String(1000 + Math.floor(Math.random() * 9000));
      try {
        const peer = await this.openPeer(PREFIX + code);
        this.code = code;
        this.side = 0;
        peer.on('connection', (conn) => {
          if (this.conn || this.closed) { conn.on('open', () => conn.close()); return; } // sala cheia
          conn.on('open', () => { this.attach(conn); onGuest?.(); });
        });
        return code;
      } catch (err) {
        if (err.type !== 'unavailable-id') throw err; // código já em uso: sorteia outro
      }
    }
    throw new Error('sem-codigo');
  }

  // Entra na sala de outra pessoa.
  async join(code) {
    this.close();
    this.reset();
    await this.loadLib();
    const peer = await this.openPeer();
    this.side = 1;
    this.code = code;
    return new Promise((resolve, reject) => {
      const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
      const timer = setTimeout(() => { this.peerError = null; reject(new Error('tempo')); }, 15000);
      this.peerError = (err) => {
        if (err.type === 'peer-unavailable') { clearTimeout(timer); this.peerError = null; reject(new Error('nao-encontrada')); }
      };
      conn.on('open', () => { clearTimeout(timer); this.peerError = null; this.attach(conn); resolve(); });
    });
  }

  attach(conn) {
    this.conn = conn;
    this.lastSeen = performance.now();
    conn.on('data', (d) => this.receive(d));
    conn.on('close', () => this.lost());
    conn.on('error', () => this.lost());
    this.pinger = setInterval(() => {
      if (this.closed) return;
      this.send({ t: 'ping', at: performance.now() });
      if (performance.now() - this.lastSeen > LOST_MS) this.lost();
    }, 1000);
  }

  send(msg) {
    if (this.conn && this.conn.open && !this.closed) this.conn.send(msg);
  }

  receive(d) {
    this.lastSeen = performance.now();
    if (!d || typeof d !== 'object') return;
    switch (d.t) {
      case 'ping': this.send({ t: 'pong', at: d.at }); return;
      case 'pong': this.rtt = performance.now() - d.at; return;
      case 'in': if (d.m === this.match) for (let k = 0; k < d.b.length; k++) this.inputs.set(d.f + k, d.b[k]); return;
      case 'sum': if (d.m === this.match) this.sums.set(d.f, d.h); return;
      case 'bye': this.byeReceived = true; this.lost(); return;
      default:
        if (this.handler) this.handler(d);
        else this.queue.push(d);
    }
  }

  // cada cena recebe as mensagens enquanto está ativa; as que chegam na troca de cena esperam na fila
  // (handler null: só vigia a conexão; as mensagens continuam na fila para a próxima cena)
  listen(scene, handler, onLost) {
    this.handler = handler;
    this.onLost = onLost;
    if (handler) this.queue.splice(0).forEach((d) => handler(d));
    scene.events.once('shutdown', () => {
      if (this.handler === handler) this.handler = null;
      if (this.onLost === onLost) this.onLost = null;
    });
  }

  newMatch(m) {
    this.match = m;
    this.inputs.clear();
    this.sums.clear();
  }

  lost() {
    if (this.closed) return;
    const cb = this.onLost;
    this.shutdown();
    cb?.(this.byeReceived ? 'bye' : 'lost');
  }

  // saída voluntária: avisa o outro lado antes de fechar
  leave() {
    if (this.closed || !this.conn) { this.close(); return; }
    this.send({ t: 'bye' });
    setTimeout(() => this.close(), 300);
    this.closed = true;
  }

  close() {
    this.shutdown();
  }

  shutdown() {
    this.closed = true;
    clearInterval(this.pinger);
    this.pinger = null;
    try { this.conn?.close(); } catch (e) { /* já fechada */ }
    try { this.peer?.destroy(); } catch (e) { /* já destruído */ }
    this.conn = null;
    this.peer = null;
    this.handler = null;
    this.queue = [];
  }
}

export const Net = new NetLink();

// comandos de um quadro em 7 bits (é isso que viaja pela rede a cada quadro)
const BITS = ['left', 'right', 'up', 'down', 'block', 'punch', 'kick'];
export const packInput = (inp) => BITS.reduce((b, k, i) => (inp[k] ? b | (1 << i) : b), 0);
export const unpackInput = (b) => Object.fromEntries(BITS.map((k, i) => [k, !!(b & (1 << i))]));

// link de convite: abre o jogo direto na sala
export const inviteLink = (code) => `${location.origin}${location.pathname}?sala=${code}`;

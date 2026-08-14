'use strict';

/**
 * NetLink — shared transport for game page and phone controllers.
 *
 * Tries a WebSocket first; if the connection cannot be established (some
 * proxies block WS upgrades) it transparently falls back to
 * Server-Sent-Events for server->client traffic plus POST requests for
 * client->server traffic.
 *
 * Handlers:
 *   onWelcome(msg)   – first message from the server (role, slot, ...)
 *   onMessage(msg)   – every other message
 *   onStatus(state)  – 'connecting' | 'connected' | 'reconnecting'
 */
class NetLink {
  constructor(role, handlers) {
    this.role = role;                      // 'screen' | 'controller'
    this.handlers = handlers || {};
    this.mode = null;                      // 'ws' | 'sse'
    this.ws = null;
    this.es = null;
    this.sseId = null;
    this.open = false;
    this.wsFailed = false;                 // sticky: skip straight to SSE
    this.reconnectDelay = 1000;
    this._reconnectTimer = null;
    this._pingTimer = null;
  }

  isOpen() { return this.open; }
  status(s) { if (this.handlers.onStatus) this.handlers.onStatus(s); }

  connect() {
    clearTimeout(this._reconnectTimer);
    this.status('connecting');
    if (this.wsFailed) { this.fallbackSSE(); } else { this.tryWS(); }
  }

  wsURL() {
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    return proto + location.host + '/ws?role=' + encodeURIComponent(this.role);
  }

  tryWS() {
    let settled = false;
    let ws;
    try { ws = new WebSocket(this.wsURL()); } catch (e) {
      this.wsFailed = true;
      return this.fallbackSSE();
    }
    const self = this;
    const failTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        self.wsFailed = true;
        try { ws.close(); } catch (e) {}
        self.fallbackSSE();
      }
    }, 3500);

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }

      if (msg.type === 'welcome') {
        if (settled) return;
        settled = true;
        clearTimeout(failTimer);
        self.mode = 'ws';
        self.ws = ws;
        self.open = true;
        self.reconnectDelay = 1000;
        self.status('connected');
        self.startPing();
        if (self.handlers.onWelcome) self.handlers.onWelcome(msg);
      } else if (self.mode === 'ws' && self.ws === ws) {
        if (self.handlers.onMessage) self.handlers.onMessage(msg);
      }
    };

    ws.onclose = () => {
      clearTimeout(failTimer);
      if (!settled) {           // never made it: fall back to SSE
        settled = true;
        self.wsFailed = true;
        self.fallbackSSE();
        return;
      }
      if (self.mode === 'ws' && self.ws === ws) {
        self.open = false;
        self.stopPing();
        self.status('reconnecting');
        self.scheduleReconnect();
      }
    };

    ws.onerror = () => { /* onclose follows */ };
  }

  async fallbackSSE() {
    this.mode = 'sse';
    const self = this;
    try {
      const r = await fetch('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: this.role })
      });
      if (!r.ok) throw new Error('join failed');
      const j = await r.json();
      this.sseId = j.id;

      // A controller with no free slot is told 'full' via the event stream.
      const es = new EventSource('/api/events?id=' + encodeURIComponent(j.id));
      this.es = es;

      es.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg.type === 'rejoin') {
          try { es.close(); } catch (e) {}
          if (self.es === es) { self.open = false; self.fallbackSSE(); }
          return;
        }
        if (msg.type === 'welcome') {
          self.open = true;
          self.reconnectDelay = 1000;
          self.status('connected');
          self.startPing();
          if (self.handlers.onWelcome) self.handlers.onWelcome(msg);
        } else if (self.handlers.onMessage) {
          self.handlers.onMessage(msg);
        }
      };

      es.onerror = () => {
        if (self.es === es) {
          try { es.close(); } catch (e) {}
          self.open = false;
          self.stopPing();
          self.status('reconnecting');
          self.scheduleReconnect();
        }
      };
    } catch (e) {
      this.status('reconnecting');
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    clearTimeout(this._reconnectTimer);
    const self = this;
    this._reconnectTimer = setTimeout(() => self.connect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.6, 8000);
  }

  send(msg) {
    if (!this.open) return;
    const data = JSON.stringify(msg);
    if (this.mode === 'ws') {
      try { if (this.ws && this.ws.readyState === 1) this.ws.send(data); } catch (e) {}
    } else if (this.mode === 'sse' && this.sseId != null) {
      fetch('/api/send?id=' + encodeURIComponent(this.sseId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: data
      }).then((r) => {
        if (r.status === 410) {           // stale session -> rejoin
          if (this.es) { try { this.es.close(); } catch (e) {} }
          this.open = false;
          this.fallbackSSE();
        }
      }).catch(() => {});
    }
  }

  startPing() {
    this.stopPing();
    const self = this;
    this._pingTimer = setInterval(() => self.send({ type: 'ping' }), 5000);
  }

  stopPing() {
    if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
  }
}

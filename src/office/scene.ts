// Studio isométrique. Ne dépend que de AgentView (aucune connaissance des collecteurs).
import { Application, Container, Graphics, Text } from "pixi.js";
import type { AgentView } from "../types";

const TW = 64;
const TH = 32;
const iso = (x: number, y: number) => ({ x: ((x - y) * TW) / 2, y: ((x + y) * TH) / 2 });

const shade = (c: number, f: number) => {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * f));
  const b = Math.min(255, Math.round((c & 255) * f));
  return (r << 16) | (g << 8) | b;
};

/** Boîte isométrique : origine (x,y) en tuiles, taille w×d tuiles, hauteur h px, élévation z px. */
function box(g: Graphics, x: number, y: number, w: number, d: number, h: number, color: number, z = 0) {
  const p = (a: number, b: number, up: number) => {
    const q = iso(a, b);
    return [q.x, q.y - up];
  };
  const t = z + h;
  g.poly([...p(x, y + d, z), ...p(x + w, y + d, z), ...p(x + w, y + d, t), ...p(x, y + d, t)]).fill(shade(color, 0.72));
  g.poly([...p(x + w, y, z), ...p(x + w, y + d, z), ...p(x + w, y + d, t), ...p(x + w, y, t)]).fill(shade(color, 0.55));
  g.poly([...p(x, y, t), ...p(x + w, y, t), ...p(x + w, y + d, t), ...p(x, y + d, t)]).fill(color);
}

function diamond(g: Graphics, x: number, y: number, w: number, d: number) {
  const a = iso(x, y), b = iso(x + w, y), c = iso(x + w, y + d), e = iso(x, y + d);
  return g.poly([a.x, a.y, b.x, b.y, c.x, c.y, e.x, e.y]);
}

const THEME: Record<AgentView["theme"], { shirt: number; accent: number; desk: number }> = {
  default: { shirt: 0x5b7cfa, accent: 0x4fb3ff, desk: 0x8a6a4f },
  cyber: { shirt: 0x2e3440, accent: 0xff4d6d, desk: 0x3b4252 },
  art: { shirt: 0xb07cf0, accent: 0xf0a3ff, desk: 0x9c7a5c },
  water: { shirt: 0x2f8fbf, accent: 0x5fd4ff, desk: 0x6f8fa8 },
};
const STATUS_HEX: Record<AgentView["status"], number> = {
  busy: 0x4fb3ff, idle: 0x4cd08a, waiting: 0xf2b84b, unknown: 0x8a93a6,
};

const textStyle = { fontFamily: "Segoe UI, sans-serif", fontSize: 11, fill: 0xe6e9ef, fontWeight: "600" as const };

/** Personnage pixel-art procédural (assis, vu de dos/trois-quarts). */
function drawCharacter(g: Graphics, shirt: number, hair: number, armPhase: number) {
  g.clear();
  g.rect(-5, -4, 10, 6).fill(0x2b2f3a); // jambes / assise
  g.rect(-6, -16, 12, 13).fill(shirt); // torse
  g.rect(-6, -16, 12, 2).fill(shade(shirt, 1.2));
  // bras (animation de frappe)
  g.rect(-8, -14 + armPhase, 3, 8).fill(shade(shirt, 0.8));
  g.rect(5, -14 - armPhase, 3, 8).fill(shade(shirt, 0.8));
  g.rect(-4, -25, 8, 9).fill(0xf1c7a1); // tête
  g.rect(-4, -26, 8, 4).fill(hair); // cheveux
  g.rect(-5, -24, 1, 5).fill(hair);
  g.rect(4, -24, 1, 5).fill(hair);
}

interface DeskView {
  root: Container;
  screen: Graphics;
  char: Graphics;
  charHolder: Container;
  bubble: Text;
  label: Text;
  dot: Graphics;
  select: Graphics;
  agent: AgentView;
  slot: { x: number; y: number };
  phase: number;
}

export class OfficeScene {
  readonly app = new Application();
  private world = new Container();
  private floor = new Graphics();
  private furniture = new Container();
  private desks = new Map<string, DeskView>();
  private slots = new Map<string, number>();
  private rows = 0;
  private time = 0;
  private selected: string | null = null;
  private dragging = false;
  private dragMoved = false;
  private onSelect: (key: string | null) => void;
  private focused = true;
  private visible = true;
  private ready = false;
  private destroyed = false;

  constructor(onSelect: (key: string | null) => void) {
    this.onSelect = onSelect;
  }

  async init(host: HTMLElement) {
    await this.app.init({
      resizeTo: host,
      background: 0x0d1017,
      antialias: false,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      powerPreference: "low-power",
      preference: "webgl",
    });
    if (this.destroyed) return;
    host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.world);
    this.world.addChild(this.floor, this.furniture);
    this.furniture.sortableChildren = true;
    this.buildStatic();
    this.layoutFloor(0);
    this.center(host);
    this.bindCamera(this.app.canvas);
    this.app.ticker.add((t) => this.update(t.deltaMS));
    this.ready = true;
    this.applyFps();
  }

  destroy() {
    this.destroyed = true;
    if (this.ready) this.app.destroy(true, { children: true });
  }

  setFocus(focused: boolean) {
    this.focused = focused;
    this.applyFps();
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.applyFps();
  }

  private applyFps() {
    if (!this.ready) return;
    if (!this.visible) return this.app.ticker.stop();
    const anyBusy = [...this.desks.values()].some((d) => d.agent.status === "busy" || d.agent.status === "waiting");
    this.app.ticker.maxFPS = !this.focused ? 8 : anyBusy ? 30 : 15;
    if (!this.app.ticker.started) this.app.ticker.start();
  }

  private center(host: HTMLElement) {
    const c = iso(8, 8);
    this.world.scale.set(1.25);
    this.world.position.set(host.clientWidth / 2 - c.x * 1.25, host.clientHeight / 2 - c.y * 1.25);
  }

  private bindCamera(canvas: HTMLCanvasElement) {
    let lx = 0, ly = 0;
    canvas.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.dragMoved = false;
      lx = e.clientX;
      ly = e.clientY;
    });
    window.addEventListener("pointerup", () => (this.dragging = false));
    canvas.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      if (!this.dragMoved && Math.abs(dx) + Math.abs(dy) < 4) return;
      this.dragMoved = true;
      this.world.x += dx;
      this.world.y += dy;
      lx = e.clientX;
      ly = e.clientY;
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        const s0 = this.world.scale.x;
        const s = Math.min(3, Math.max(0.4, s0 * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
        const wx = (mx - this.world.x) / s0, wy = (my - this.world.y) / s0;
        this.world.scale.set(s);
        this.world.position.set(mx - wx * s, my - wy * s);
      },
      { passive: false },
    );
    this.app.stage.eventMode = "static";
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on("pointertap", (e) => {
      if (!this.dragMoved && e.target === this.app.stage) this.onSelect(null);
    });
  }

  /** Décor fixe : bureau direction Kobunix + poste sentinel-leader. */
  private buildStatic() {
    const g = new Graphics();
    // Bureau Kobunix (zone vitrée)
    diamond(g, 0.5, 0.5, 6, 4.5).fill(0x2a2438);
    diamond(g, 0.5, 0.5, 6, 4.5).stroke({ width: 2, color: 0x8f7fd0, alpha: 0.6 });
    box(g, 2, 1.4, 2.6, 1.1, 16, 0x5a3e2b); // grand bureau
    for (let i = 0; i < 3; i++) box(g, 2.2 + i * 0.8, 1.45, 0.6, 0.15, 14, 0x1b1f2a, 16); // 3 moniteurs
    box(g, 0.8, 0.8, 0.6, 0.6, 22, 0x2f7a46); // plante
    box(g, 5.6, 0.8, 0.5, 1.8, 30, 0x3d3550); // bibliothèque
    // Zone leader
    diamond(g, 7.5, 0.5, 5, 4).fill(0x1f2a33);
    box(g, 8, 0.6, 3.2, 0.12, 34, 0xd8dee9); // tableau de coordination
    g.rect(iso(8.3, 0.6).x, iso(8.3, 0.6).y - 30, 12, 6).fill(0xf2b84b);
    g.rect(iso(9.3, 0.6).x, iso(9.3, 0.6).y - 26, 12, 6).fill(0x4fb3ff);
    g.rect(iso(10.2, 0.6).x, iso(10.2, 0.6).y - 30, 12, 6).fill(0x4cd08a);
    box(g, 8.6, 1.6, 2.4, 1, 16, 0x4a5568);
    for (let i = 0; i < 2; i++) box(g, 8.9 + i * 1, 1.65, 0.8, 0.15, 14, 0x1b1f2a, 16);
    g.zIndex = 0;
    this.furniture.addChild(g);

    // Kobunix : avatar fixe, sans activité inventée
    const k = new Graphics();
    drawCharacter(k, 0x8f7fd0, 0x2b1d14, 0);
    const kp = iso(3.3, 3.0);
    k.position.set(kp.x, kp.y);
    k.zIndex = 50;
    const kl = new Text({ text: "Kobunix · Project Owner", style: { ...textStyle, fill: 0xcfc6f5 }, resolution: 2 });
    kl.anchor.set(0.5, 1);
    kl.position.set(kp.x, kp.y - 30);
    kl.zIndex = 1000;
    this.furniture.addChild(k, kl);
  }

  private layoutFloor(agentCount: number) {
    const rows = Math.max(3, Math.ceil(agentCount / 4) + 1);
    if (rows === this.rows) return; // pas de reconstruction inutile
    this.rows = rows;
    const W = 14, H = 6 + rows * 3;
    const g = this.floor.clear();
    for (let x = 0; x < W; x++)
      for (let y = 0; y < H; y++) diamond(g, x, y, 1, 1).fill((x + y) % 2 ? 0x1a1f2b : 0x1d2330);
    // murs arrière
    box(g, 0, -0.3, W, 0.3, 46, 0x2b3242);
    box(g, -0.3, 0, 0.3, H, 46, 0x252b39);
    for (let x = 1; x < W; x += 3) box(g, x, -0.32, 1.2, 0.02, 18, 0x3b5b7a, 16); // fenêtres
  }

  private slotFor(a: AgentView): { x: number; y: number } {
    if (a.role === "leader") return { x: 9.2, y: 2.9 };
    let idx = this.slots.get(a.key);
    if (idx === undefined) {
      const taken = new Set(this.slots.values());
      idx = 0;
      while (taken.has(idx)) idx++;
      this.slots.set(a.key, idx);
    }
    return { x: 1.2 + (idx % 4) * 3.2, y: 6.5 + Math.floor(idx / 4) * 3 };
  }

  /** Met à jour les postes : création/suppression ciblées uniquement. */
  setAgents(agents: AgentView[]) {
    if (!this.ready) return;
    const keys = new Set(agents.map((a) => a.key));
    for (const [k, d] of this.desks) {
      if (!keys.has(k)) {
        d.root.destroy({ children: true });
        this.desks.delete(k);
        this.slots.delete(k);
      }
    }
    this.layoutFloor(agents.filter((a) => a.role !== "leader").length);
    for (const a of agents) {
      const d = this.desks.get(a.key);
      if (d) {
        const changed = d.agent.status !== a.status || d.agent.displayName !== a.displayName;
        d.agent = a;
        if (changed) this.refreshDesk(d);
      } else this.desks.set(a.key, this.createDesk(a));
    }
    this.applySelection();
    this.applyFps();
  }

  select(key: string | null) {
    this.selected = key;
    this.applySelection();
  }

  private applySelection() {
    for (const [k, d] of this.desks) d.select.visible = k === this.selected;
  }

  private createDesk(a: AgentView): DeskView {
    const slot = this.slotFor(a);
    const th = THEME[a.theme];
    const root = new Container();
    root.zIndex = Math.round((slot.x + slot.y) * 10);
    root.eventMode = "static";
    root.cursor = "pointer";
    root.on("pointertap", () => {
      if (!this.dragMoved) this.onSelect(a.key);
    });

    const select = new Graphics();
    diamond(select, slot.x - 0.3, slot.y - 0.3, 2.2, 2.4).stroke({ width: 2, color: 0xffffff, alpha: 0.85 });
    select.visible = false;

    const base = new Graphics();
    diamond(base, slot.x - 0.2, slot.y - 0.2, 2, 2.2).fill({ color: th.accent, alpha: 0.08 });
    box(base, slot.x, slot.y, 1.6, 0.8, 16, th.desk); // bureau
    box(base, slot.x + 0.15, slot.y + 0.05, 1.3, 0.12, 2, 0x1b1f2a, 16); // pied d'écran
    if (a.theme === "water") box(base, slot.x - 0.2, slot.y + 0.1, 0.35, 0.6, 18, 0x2a7fb0); // aquarium
    if (a.theme === "cyber") box(base, slot.x + 1.7, slot.y, 0.35, 0.35, 30, 0x2b303b); // baie serveur
    if (a.theme === "art") box(base, slot.x + 1.7, slot.y + 0.2, 0.15, 0.6, 26, 0xd8cbb8); // chevalet
    box(base, slot.x + 0.6, slot.y + 1.15, 0.5, 0.5, 9, 0x30343f); // chaise

    const screen = new Graphics();
    const sp = iso(slot.x + 0.25, slot.y + 0.1);
    screen.position.set(sp.x, sp.y - 30);

    const charHolder = new Container();
    const cp = iso(slot.x + 0.85, slot.y + 1.4);
    charHolder.position.set(cp.x, cp.y - 6);
    const char = new Graphics();
    charHolder.addChild(char);

    const label = new Text({ text: "", style: textStyle, resolution: 2 });
    label.anchor.set(0.5, 1);
    label.position.set(cp.x + 6, cp.y - 40);
    const dot = new Graphics();
    const bubble = new Text({ text: "", style: { ...textStyle, fontSize: 16, fill: 0xf2b84b }, resolution: 2 });
    bubble.anchor.set(0.5, 1);
    bubble.position.set(cp.x, cp.y - 54);

    root.addChild(select, base, screen, charHolder, dot, label, bubble);
    this.furniture.addChild(root);
    const d: DeskView = { root, screen, char, charHolder, bubble, label, dot, select, agent: a, slot, phase: 0 };
    this.refreshDesk(d);
    return d;
  }

  private refreshDesk(d: DeskView) {
    const a = d.agent;
    d.label.text = a.identityCertain ? a.displayName : `${a.displayName} ?`;
    d.label.style.fill = a.identityCertain ? 0xe6e9ef : 0xa0a8b8;
    const lb = d.label.getLocalBounds();
    d.dot.clear().circle(d.label.x - lb.width / 2 - 7, d.label.y - 7, 4).fill(STATUS_HEX[a.status]);
    d.bubble.text = a.status === "waiting" ? "!" : "";
    d.charHolder.alpha = a.status === "unknown" ? 0.5 : 1;
    drawCharacter(d.char, THEME[a.theme].shirt, 0x3b2a20, 0);
    d.phase = 0;
  }

  private update(dt: number) {
    this.time += dt;
    const t = this.time / 1000;
    for (const d of this.desks.values()) {
      const s = d.agent.status;
      const th = THEME[d.agent.theme];
      // écran : lignes défilantes si occupé, faible lueur sinon
      const sc = d.screen.clear();
      sc.rect(0, 0, 54, 20).fill(0x0b0e14);
      if (s === "busy") {
        const off = Math.floor(t * 6) % 4;
        for (let i = 0; i < 4; i++) {
          const w = 10 + (((i + off) * 37) % 34);
          sc.rect(4, 3 + i * 4, w, 2).fill({ color: th.accent, alpha: 0.85 });
        }
      } else if (s === "waiting") {
        sc.rect(2, 2, 50, 16).fill({ color: 0xf2b84b, alpha: 0.25 + 0.2 * Math.sin(t * 4) });
      } else {
        sc.rect(2, 2, 50, 16).fill({ color: th.accent, alpha: 0.12 });
      }
      // personnage : frappe rapide si occupé, respiration lente sinon
      const phase = s === "busy" ? (Math.floor(t * 8) % 2 ? 1 : -1) : 0;
      if (phase !== d.phase) {
        d.phase = phase; // redessin uniquement quand la pose change
        drawCharacter(d.char, th.shirt, 0x3b2a20, phase);
      }
      if (s === "busy") {
        d.char.y = 0;
      } else {
        d.char.y = Math.sin(t * 1.5) > 0.6 ? -1 : 0;
      }
      if (s === "waiting") d.bubble.alpha = 0.6 + 0.4 * Math.sin(t * 5);
    }
  }
}
